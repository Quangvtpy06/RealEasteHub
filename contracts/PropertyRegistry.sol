// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

// Nhập contract CertificateNFT vào
import {CertificateNFT} from "./CertificateNFT.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

//tạo contract PropertyRegistryd để quản lý tài sản bđs và cá nhân
//@notice Backend Postgres đã lưu hồ sơ chi tiết. Contract chỉ xác định hash/ID để xác thực
contract PropertyRegistry is AccessControl {
    // Cấp quyền người quản lý
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    // Cấp quyền ký quỹ
    bytes32 public constant ESCROW_ROLE = keccak256("ESCROW_ROLE");
    
    CertificateNFT public immutable NFTContract;
    uint256 public nextPropertyId = 1;

    //@notice Tạo dữ liệu cá nhân tối thiểu on-chain
    //backendPersonID là ID person lưu bên schcema.sql
    //datahash là mã hồ sơ cá nhân lưu trực tiếp lên chain, cccd/sđt lưu ở backend
    struct Person {
        bytes32 backendPersonId;
        bytes32 datahash;
        address wallet;
        bool verified;
        uint256 CreatedAt;
        uint256 UpdatedAt;
    }

    // định nghĩa struct Property tương ứng với property bên backend
    struct Property {
        uint256 id;
        bytes32 backendPropertyId;
        bytes32 propertydataHash;
        bytes32 legalDocumentHash;
        uint256 certificateTokenId;
        address currentOwner;
        address createdBy;
        string location;
        string certificateURI;
        bool active;
        uint256 createdAt;
        uint256 updatedAt;
    }
    
    //mapping theo dõi địa chỉ ví cá nhân
    mapping(bytes32 => Person) private persons;
    mapping(address => bytes32) public personIdByWallet;
    //mapping theo dõi ID tài sản
    mapping(uint256 => Property) private properties;
    mapping(bytes32 => uint256) public propertyIdByBackend;

    //tạo event lưu lại thông tin đăng ký người dùng
    event PersonRegistered(
        bytes32 indexed backendPersonId,
        address indexed wallet,
        bytes32 datahash
    );

    //tạo event theo dõi khi người dùng xác nhận thay đổi
    event PersonVerificationChanged(
        bytes32 indexed backendPersonId,
        address indexed wallet,
        bool verified
    );
    
    //tạo event theo dõi địa chỉ ví chuyển nhượng
    event PersonWalletChanged(
        bytes32 indexed backendPersonId,
        address indexed oldWallet,
        address indexed newWallet
    );
    
    //tạo event cập nhật datahash khi được update
    event PersonDataHashUpdated(
        bytes32 indexed backendPersonId,
        bytes32 datahash
    );

    //tạo event lưu lại tài sản được xác nhận với NFT
    event PropertyRegistered(
        uint256 indexed propertyId,
        bytes32 indexed backendPropertyId,
        uint256 indexed certificateTokenId,
        address owner
    );

    //tạo event lưu dữ liệu update của property
    event PropertyDataUpdated(
        uint256 indexed PropertyId,
        bytes32 PropertyDataHash,
        bytes32 legalDocumentHash,
        string location
    );
    
    //tạo event theo dõi owner chuyển nhượng
    event PropertyOwnerChanged(
        uint256 indexed PropertyId,
        address indexed oldOwner,
        address indexed newOwner
    );

    //tạo event theo dõi property được active
    event PropertyActiveChanged(
        uint256 indexed PropertyId,
        bool active
    );

    //tạo event theo dõi URI xác nhận sau update
    event CertificateURIUpdated(
        uint256 indexed PropertyId,
        uint256 indexed TokenId,
        string CertificateURI
    );
    
    //tạo điều kiện kiểm tra property có tồn tại không
    modifier propertyExists(uint256 PropertyId) {
        require(properties[PropertyId].id != 0, "PROPERTY_NOT_FOUND");
        _;
    }

    //tạo điều kiện kiểm tra person có tồn tại không
    modifier personExists(bytes32 backendPersonId) {
        require(persons[backendPersonId].backendPersonId != bytes32(0), "PERSON_NOT_FOUND");
        _;
    }

    //thiết lập truyền địa chỉ admin và địa chỉ certificateNFTAddress
    constructor(address admin, address certificateNFTAddress) {
        require(admin != address(0), "ADMIN_REQUIRED"); //không cho admin rỗng
        require(certificateNFTAddress != address(0), "NFT_REQUIRED"); // không cho địa chỉ NFT rỗng
        //cho phép contract hiện tại gọi contract NFT
        NFTContract = CertificateNFT(certificateNFTAddress);
        //cấp vai trò cao nhất cho admin
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MANAGER_ROLE, admin);
    }
    
    /* Quản lý cá nhân
    @notice Manager ghi nhận 1 user đã có trong hồ sơ PostgreSQL */
    //tạo function cho người đăng ký
    function RegisterPerson(
    bytes32 backendPersonId,
    address Wallet,
    uint256 datahash,
    bool verified
) external {
    require(backendPersonId != bytes32(0), "PERSON_ID_REQUIRED");
    require(Wallet != address(0), "WALLET_REQUIRED");
    if (!hasRole(MANAGER_ROLE, msg.sender)) {
        require(msg.sender == Wallet, "ONLY_SELF_OR_MANAGER");
        require(!verified, "SELF_CANNOT_VERIFY");
    }
    //kiểm tra xem cá nhân đó có tồn tại theo ID backend
    require(persons[backendPersonId].backendPersonId == bytes32(0), "PERSON_EXISTS");
    //kiểm tra xem ví đã được dùng chưa
    require(personIdByWallet[Wallet] == bytes32(0), "WALLET_USED");

    persons[backendPersonId] = Person({
        backendPersonId: backendPersonId,
        datahash: bytes32(datahash),
        wallet: Wallet,
        verified: verified,
        CreatedAt: block.timestamp,
        UpdatedAt: block.timestamp
    });
    //ví người dùng nối với ví cá nhân backend
    personIdByWallet[Wallet] = backendPersonId;
    //xuất 2 event Personregistered và PersonVerificationChanged
    emit PersonRegistered(backendPersonId, Wallet, bytes32(datahash));
    emit PersonVerificationChanged(backendPersonId, Wallet, verified);
    }
    
    //tạo function set xác nhận cá nhân
    function setPersonVerified(
        bytes32 backendPersonId,
        bool verified
    ) external onlyRole(MANAGER_ROLE) personExists(backendPersonId) {
        Person storage person = persons[backendPersonId];
        person.verified = verified;
        person.UpdatedAt = block.timestamp;

        emit PersonVerificationChanged(backendPersonId, person.wallet, verified);
    }

    //tạo function cập nhật datahash cho cá nhân
    function updatePersonDataHash(
        bytes32 backendPersonId,
        bytes32 dataHash
    ) external onlyRole(MANAGER_ROLE) personExists(backendPersonId) {
        Person storage person = persons[backendPersonId];
        person.datahash = dataHash;
        person.UpdatedAt = block.timestamp;

        emit PersonDataHashUpdated(backendPersonId, dataHash);
    }

    //tạo function cập nhật ví cá nhân
    function updatePersonWallet(
        bytes32 backendPersonId,
        address newWallet
    ) external onlyRole(MANAGER_ROLE) personExists(backendPersonId) {
        require(newWallet != address(0), "WALLET_REQUIRED");
        require(personIdByWallet[newWallet] == bytes32(0), "WALLET_USED");
        //lấy ra lưu trữ person ở backend
        Person storage person = persons[backendPersonId];
        address oldWallet = person.wallet;
        //xóa ví cũ
        delete personIdByWallet[oldWallet];
        person.wallet = newWallet; //truyền ví mới vào
        person.UpdatedAt = block.timestamp;
        personIdByWallet[newWallet] = backendPersonId;

        emit PersonWalletChanged(backendPersonId, oldWallet, newWallet);
    }

    /*@notice:Quản lý property và user mint NFT*/
    //tạo hàm đọc dữ liệu cho be và fe khi xác nhận ví
    function isVerifiedWallet(address wallet) public view returns (bool) {
        bytes32 backendPersonId = personIdByWallet[wallet];
        return backendPersonId != bytes32(0) && persons[backendPersonId].verified;
    }

    function isRegisteredWallet(address wallet) public view returns (bool) {
        return personIdByWallet[wallet] != bytes32(0);
    }

     //tạo function đăng ký tài sản
    function registerProperty(
    bytes32 backendPropertyId,
    address initialOwner,
    bytes32 propertydataHash,
    bytes32 legalDocumentHash,
    string calldata location,
    string calldata certificateURI
    //returns.. trả về 2 giá trị lưu trữ vào backend
) external returns (uint256 propertyId, uint256 tokenId) {
    require(backendPropertyId != bytes32(0), "PROPERTY_ID_REQUIRED");
    require(propertyIdByBackend[backendPropertyId] == 0, "PROPERTY_EXISTS");
    require(initialOwner != address(0), "OWNER_REQUIRED");
    require(
        hasRole(MANAGER_ROLE, msg.sender) || msg.sender == initialOwner,
        "ONLY_MANAGER_OR_OWNER"
    );
    //Cho user tự mint sau khi ví đã có hồ sơ on-chain. 
    //Manager vẫn có thể mint thay trong demo/quản trị.
    require(isRegisteredWallet(initialOwner), "OWNER_NOT_REGISTERED");
    require(bytes(location).length > 0, "LOCATION_REQUIRED");
    require(bytes(certificateURI).length > 0, "CERTIFICATE_URI_REQUIRED");
    //value là tokenId=propertyId mới=propertyId cũ+1
    propertyId = nextPropertyId++;
    tokenId = propertyId;
    //tạo 1 property mới thay thế
    properties[propertyId] = Property({
        id: propertyId,
        backendPropertyId: backendPropertyId,
        propertydataHash: propertydataHash,
        legalDocumentHash: legalDocumentHash,
        certificateTokenId: tokenId,
        currentOwner: initialOwner,
        createdBy: msg.sender,
        location: location,
        certificateURI: certificateURI,
        active: true,
        createdAt: block.timestamp,
        updatedAt: block.timestamp
    });
    //Id property từ backed = propertyId trong SC
    propertyIdByBackend[backendPropertyId] = propertyId;
    //lấy function minCertificate từ CertificateNFT.sol
    NFTContract.mintCertificate(initialOwner, tokenId, propertyId, certificateURI);
    //xuất ra event sau khi gọi function này
    emit PropertyRegistered(propertyId, backendPropertyId, tokenId, initialOwner);
    }
    //tạo function lưu dữ liệu update cho tài sản
    function updatePropertyData(
        uint256 propertyId,
        bytes32 propertyDataHash,
        bytes32 legalDocumentHash,
        string calldata location
    ) external onlyRole(MANAGER_ROLE) propertyExists(propertyId) {
        require(bytes(location).length > 0, "LOCATION_REQUIRED");
        //lấy property cần sửa từ mapping
        Property storage target = properties[propertyId];
        //khi sửa target thì data properties[propertyId] cũng thay đổi theo
        target.propertydataHash = propertyDataHash;
        target.legalDocumentHash = legalDocumentHash;
        target.location = location;
        target.updatedAt = block.timestamp;

        emit PropertyDataUpdated(propertyId, propertyDataHash, legalDocumentHash, location);
    }
    
    //tạo function lưu URI update của Certificate
    function updateCertificateURI(
        uint256 propertyId,
        string calldata certificateURI
    ) external onlyRole(MANAGER_ROLE) propertyExists(propertyId) {
        require(bytes(certificateURI).length > 0, "CERTIFICATE_URI_REQUIRED");

        Property storage target = properties[propertyId];
        target.certificateURI = certificateURI;
        target.updatedAt = block.timestamp;
        //gọi function UpdateCertificate từ CertificateNFT.sol
        NFTContract.UpdateCertificate(target.certificateTokenId, certificateURI);
        emit CertificateURIUpdated(propertyId, target.certificateTokenId, certificateURI);
    }
    
    //tạo function lưu trạng thái update của tài sản
    function setPropertyActive(
        uint256 propertyId,
        bool active
    ) external onlyRole(MANAGER_ROLE) propertyExists(propertyId) {
        properties[propertyId].active = active;
        properties[propertyId].updatedAt = block.timestamp;

        emit PropertyActiveChanged(propertyId, active);
    }

    //Escrow gọi sau khi giao dịch đã được manager xác nhận và NFT đã chuyển cho buyer
    function updateOwnerFromEscrow(
        uint256 propertyId,
        address newOwner
    ) external onlyRole(ESCROW_ROLE) propertyExists(propertyId) {
        require(isRegisteredWallet(newOwner), "NEW_OWNER_NOT_REGISTERED");

        Property storage target = properties[propertyId];
        require(target.active, "PROPERTY_INACTIVE");
        //lưu lại OldOwner(seller) và newOwner(buyer)
        address oldOwner = target.currentOwner;
        target.currentOwner = newOwner;
        target.updatedAt = block.timestamp;

        emit PropertyOwnerChanged(propertyId, oldOwner, newOwner);
    }

    /*Những function đọc data bổ sung cho be và fe*/
    //function đọc thông tin cá nhân từ backend
    function getPerson(bytes32 backendPersonId) 
    external view personExists(backendPersonId) returns (Person memory) {
        return persons[backendPersonId];
    }
    //function đọc địa chỉ ví của cá nhân
    function getPersonByWallet(address wallet) 
    external view returns (Person memory) {
        bytes32 backendPersonId = personIdByWallet[wallet];
        require(backendPersonId != bytes32(0), "PERSON_NOT_FOUND");
        return persons[backendPersonId];
    }
    //function đọc thông tin property
    function getProperty(uint256 propertyId) 
    external view propertyExists(propertyId) returns (Property memory) {
        return properties[propertyId];
    }
    //function đọc người sở hữu property
    function getPropertyOwner(uint256 propertyId) 
    external view propertyExists(propertyId) returns (address) {
        return properties[propertyId].currentOwner;
    }
    //function đọc tokenId của NFT gán với property
    function getCertificateTokenId(uint256 propertyId) 
    external view propertyExists(propertyId) returns (uint256) {
        return properties[propertyId].certificateTokenId;
    }
    //function đọc property đang hoạt động
    function isPropertyActive(uint256 propertyId) 
    external view propertyExists(propertyId) returns (bool) {
        return properties[propertyId].active;
    }
    //function đọc xác nhận có phải owner hiện tại của property không
    function verifyOwnership(uint256 propertyId, address account) 
    external view propertyExists(propertyId) returns (bool) {
        Property storage target = properties[propertyId];
        return target.active && target.currentOwner == account;
    }
}
