// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
//import các kiểu dữ liệu từ contracts khác vào
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
/*ReentrancyGuard của openzeppelin dùng để ngăn chặn việc tái nhập hàm
    đơn giản là nó có modifer nonReentrant khóa trạng thái rồi mói cho phép run function
    sau khi chạy toàn bộ logic bên trong thì nó mở khóa, việc này dành cho các thao tác nhạy cảm như:
    rút tiền, chuyển khoản token, giao dịch NFT
nguồn: https://docs.openzeppelin.com/contracts/5.x/api/utils#reentrancyguard
*/
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PropertyRegistry} from "./PropertyRegistry.sol";

/*contract này chỉ xử lý quy trình mua bán trọn NFT giấy chứng nhận qua trung gian hệ thống.
@notice smartcontract này chỉ lưu trạng thái xác thực và chuyển NFT.*/
contract PropertyTransactionEscrow is AccessControl, ERC721Holder, ReentrancyGuard {
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    //khai báo các biến
    PropertyRegistry public immutable propertyRegistry;
    IERC721 public immutable certificateNFT;
    uint256 public nextSaleId = 1; //saleId bắt đầu từ 1
    //khai báo danh sách trạng thái của hồ sơ
    enum SaleStatus {
        None,
        Created,
        Deposited,
        Released,
        Cancelled
    }
    //tạo struct hồ sơ giao dịch
    struct CertificateSale {
        uint256 id;
        uint256 propertyId;
        uint256 certificateTokenId;
        address seller;
        address buyer;
        uint256 priceWei;
        bytes32 backendTransactionId;
        bytes32 documentHash;
        SaleStatus status;
        uint256 createdAt;
        uint256 depositedAt;
        uint256 releasedAt;
        uint256 cancelledAt;
        address releasedBy;
    }
    //mapping CertificateSale để tra cứu dữ liệu từng giao dịch
    mapping(uint256 => CertificateSale) private certificateSales; //chi tiết lưu vào certificateSales
    mapping(uint256 => uint256) public activeSaleByProperty; //giao dịch đang active
    mapping(uint256 => uint256[]) private saleIdsByProperty; //Id property giao dịch
    mapping(bytes32 => uint256) public saleIdByBackendTransactionId; //lấy Id backend của giao dịch

    //tạo event cho hồ sơ giao dịch được tạo ra
    event CertificateSaleCreated(
        uint256 indexed saleId, //indexed để lọc nhanh hơn và chỉ tối đa 3 indexed 1 event
        uint256 indexed propertyId,
        address indexed seller,
        address buyer,
        uint256 priceWei,
        bytes32 backendTransactionId
    );
    //tạo event hồ sơ giao dịch được gửi vào Escrow
    event CertificateDeposited(
        uint256 indexed saleId,
        uint256 indexed propertyId, 
        address indexed seller
    );
    //tạo hồ sơ giao dịch được xác nhận
    event CertificateReleased(
        uint256 indexed saleId,
        uint256 indexed propertyId,
        address indexed buyer,
        address releasedBy
    );
    //tạo hồ sơ giao dịch đã hủy
    event CertificateSaleCancelled(
        uint256 indexed saleId, 
        uint256 indexed propertyId
        );
    //kiểm tra xem hồ sơ giao dịch có tồn tại chưa
    modifier saleExists(uint256 saleId) {
        require(certificateSales[saleId].id != 0, "SALE_NOT_FOUND");
        _;
    }
    //tạo constructor truyền địa chỉ admin, địa chỉ đăng ký và địa chỉ NFT vào
    constructor(address admin, address registryAddress, address nftAddress) {
        require(admin != address(0), "ADMIN_REQUIRED");
        require(registryAddress != address(0), "REGISTRY_REQUIRED");
        require(nftAddress != address(0), "NFT_REQUIRED");
        //cho phép contract hiện tại gọi 2 contract bên dưới
        propertyRegistry = PropertyRegistry(registryAddress);
        certificateNFT = IERC721(nftAddress);
        //cấp quyền admin cao nhất 
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MANAGER_ROLE, admin);
    }

    /*Tạo hồ sơ cho yêu cầu chuyển nhượng từ seller --> buyer
    backendTransactionId là hash giao dichj trong Postgres ở backend*/
    //function tạo hồ sơ chuyển nhượng
    function createCertificateSale(
        uint256 propertyId,
        address buyer,
        uint256 priceWei,
        bytes32 backendTransactionId,
        bytes32 documentHash
    ) external nonReentrant returns (uint256 saleId) /*trả về saleId khi call*/{
        require(buyer != address(0), "BUYER_REQUIRED"); //chỉ người mua 
        require(buyer != msg.sender, "BUYER_EQUALS_SELLER");
        require(backendTransactionId != bytes32(0), "BACKEND_TX_REQUIRED");
        require(saleIdByBackendTransactionId[backendTransactionId] == 0, "BACKEND_TX_EXISTS");
        require(propertyRegistry.isPropertyActive(propertyId), "PROPERTY_INACTIVE");
        require(propertyRegistry.verifyOwnership(propertyId, msg.sender), "ONLY_PROPERTY_OWNER");
        require(propertyRegistry.isVerifiedWallet(buyer), "BUYER_NOT_VERIFIED");
        require(activeSaleByProperty[propertyId] == 0, "ACTIVE_SALE_EXISTS");
        //tokenId của NFT lấy từ propertyId của contract PropertyRegistry.sol
        uint256 tokenId = propertyRegistry.getCertificateTokenId(propertyId);
        //kiểm tra có phải NFT của người chuyển nhượng không
        require(certificateNFT.ownerOf(tokenId) == msg.sender, "SELLER_NOT_NFT_HOLDER");
        //danh sách hồ sơ tăng dần từ 1
        saleId = nextSaleId++;
        //tạo 1 giao dịch mới lưu vào smartcontract với các biến sau
        certificateSales[saleId] = CertificateSale({
            id: saleId,
            propertyId: propertyId,
            certificateTokenId: tokenId,
            seller: msg.sender,
            buyer: buyer,
            priceWei: priceWei,
            backendTransactionId: backendTransactionId,
            documentHash: documentHash,
            status: SaleStatus.Created,
            createdAt: block.timestamp,
            depositedAt: 0, //khi chưa xảy ra thì thời điểm để rỗng
            releasedAt: 0,
            cancelledAt: 0,
            releasedBy: address(0)
        });

        //lưu lại hồ sơ đang active, lịch sử mở và liên kết đến backend        
        activeSaleByProperty[propertyId] = saleId;
        saleIdsByProperty[propertyId].push(saleId);
        saleIdByBackendTransactionId[backendTransactionId] = saleId;
        //call ra các biến từ event tạo hồ sơ
        emit CertificateSaleCreated(saleId, propertyId, msg.sender, buyer, priceWei, backendTransactionId);
    }

    //function chuyển NFT vào Escrow sau đó đợi approve
    function depositCertificate(
        uint256 saleId
    ) external nonReentrant saleExists(saleId) {
        //lấy saleId từ mapping certificateSales
        CertificateSale storage sale = certificateSales[saleId];
        require(sale.status == SaleStatus.Created, 
            "SALE_NOT_CREATED"
        ); //kiểm tra hồ sơ có chưa
        require(msg.sender == sale.seller, "ONLY_SELLER"); //chỉ cho người bán gửi
        require(certificateNFT.ownerOf(sale.certificateTokenId) == sale.seller, 
            "SELLER_NOT_NFT_HOLDER"
        );
        //lấy hàm từ contract CertificateNFT.sol để chuyển hàm từ ERC721 vào Escrow
        certificateNFT.safeTransferFrom(sale.seller, address(this), sale.certificateTokenId);

        sale.status = SaleStatus.Deposited;
        sale.depositedAt = block.timestamp;
        //call ra các biến từ event chuyển NFT vào Escrow
        emit CertificateDeposited(saleId, sale.propertyId, sale.seller);
    }
    //function xác nhận hồ sơ chuyển nhượng xong thì release NFT cho buyer
    function releaseCertificateToBuyer(
        uint256 saleId
    ) external onlyRole(MANAGER_ROLE)/*Chỉ cho admin call*/ 
    nonReentrant saleExists(saleId) {
        CertificateSale storage sale = certificateSales[saleId];
        require(sale.status == SaleStatus.Deposited, "SALE_NOT_DEPOSITED");
        require(certificateNFT.ownerOf(sale.certificateTokenId) == address(this), 
            "NFT_NOT_IN_ESCROW"
        );

        sale.status = SaleStatus.Released;
        sale.releasedAt = block.timestamp;
        sale.releasedBy = msg.sender;
        activeSaleByProperty[sale.propertyId] = 0;
        //lấy hàm từ 2 contract đúc NFT vào đăng ký property
        certificateNFT.safeTransferFrom(address(this), sale.buyer, sale.certificateTokenId);
        propertyRegistry.updateOwnerFromEscrow(sale.propertyId, sale.buyer);
        //call ra event sau
        emit CertificateReleased(saleId, sale.propertyId, sale.buyer, msg.sender);
    }
    /*function xóa hồ sơ nếu seller hoặc admin hủy 
    @notice NẾU NFT ĐÃ VÀO ESCROW THÌ HOÀN LẠI BUYER*/
    function cancelCertificateSale(
        uint256 saleId
    ) external nonReentrant saleExists(saleId) {
        CertificateSale storage sale = certificateSales[saleId];
        //Không thể hủy giao dịch nếu giao dịch chưa tạo hoặc chưa gửi vào Escrow
        require(
            sale.status == SaleStatus.Created || sale.status == SaleStatus.Deposited,
            "SALE_CANNOT_BE_CANCELLED"
        );
        require(msg.sender == sale.seller || hasRole(MANAGER_ROLE, msg.sender), 
            "ONLY_SELLER_OR_MANAGER"
        );
        //Nếu NFT đã có trong Escrow thì sẽ hoàn lại buyer
        if (sale.status == SaleStatus.Deposited) {
            require(certificateNFT.ownerOf(sale.certificateTokenId) == address(this), 
                "NFT_NOT_IN_ESCROW"
            );
            certificateNFT.safeTransferFrom(
                address(this), 
                sale.seller, 
                sale.certificateTokenId
            );
        }
        //cập nhật các thông tin sau khi cancelled
        sale.status = SaleStatus.Cancelled;
        sale.cancelledAt = block.timestamp;
        activeSaleByProperty[sale.propertyId] = 0;
        //call ra event hủy hồ sơ
        emit CertificateSaleCancelled(saleId, sale.propertyId);
    }
    //function lấy Id hợp đồng giao dịch, chỉ đọc lịch sử các giao dịch và trả về
    function getCertificateSale(
        uint256 saleId
    ) external view saleExists(saleId) returns (CertificateSale memory) {
        return certificateSales[saleId];
    }
    //function lấy Id property, chỉ đọc lịch sử property giao dịch và trả về
    function getSalesByProperty(
        uint256 propertyId
    ) external view returns (uint256[] memory) {
        return saleIdsByProperty[propertyId];
    }
}