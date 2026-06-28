// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PropertyRegistry} from "./PropertyRegistry.sol";

/// @notice Marketplace escrow for listed property certificate NFTs.
/// Seller lists by approving this contract, while the NFT stays in the seller wallet.
/// Buyer pays seller price plus platform fee, then the contract atomically sends
/// NFT to buyer, fee to admin, and proceeds to seller.
contract PropertyTransactionEscrow is AccessControl, ReentrancyGuard {
    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");

    PropertyRegistry public immutable propertyRegistry;
    IERC721 public immutable certificateNFT;
    address payable public feeRecipient;

    uint256 public constant FEE_BPS = 100; // 1%
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public nextSaleId = 1;

    enum SaleStatus {
        None,
        Listed,
        Sold,
        Cancelled
    }

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

    mapping(uint256 => CertificateSale) private certificateSales;
    mapping(uint256 => uint256) public activeSaleByProperty;
    mapping(uint256 => uint256[]) private saleIdsByProperty;
    mapping(bytes32 => uint256) public saleIdByBackendTransactionId;
    mapping(uint256 => uint256) public saleFeeWei;

    event CertificateSaleCreated(
        uint256 indexed saleId,
        uint256 indexed propertyId,
        address indexed seller,
        address buyer,
        uint256 priceWei,
        bytes32 backendTransactionId
    );

    event CertificateListed(
        uint256 indexed saleId,
        uint256 indexed propertyId,
        uint256 indexed certificateTokenId,
        address seller,
        uint256 priceWei
    );

    event CertificatePurchased(
        uint256 indexed saleId,
        uint256 indexed propertyId,
        uint256 indexed certificateTokenId,
        address seller,
        address buyer,
        uint256 priceWei,
        uint256 feeWei,
        uint256 sellerProceedsWei
    );

    event CertificateDeposited(
        uint256 indexed saleId,
        uint256 indexed propertyId,
        address indexed seller,
        uint256 feeWei
    );

    event CertificateReleased(
        uint256 indexed saleId,
        uint256 indexed propertyId,
        address indexed buyer,
        address releasedBy
    );

    event CertificateSaleCancelled(
        uint256 indexed saleId,
        uint256 indexed propertyId
    );

    modifier saleExists(uint256 saleId) {
        require(certificateSales[saleId].id != 0, "SALE_NOT_FOUND");
        _;
    }

    constructor(address admin, address registryAddress, address nftAddress) {
        require(admin != address(0), "ADMIN_REQUIRED");
        require(registryAddress != address(0), "REGISTRY_REQUIRED");
        require(nftAddress != address(0), "NFT_REQUIRED");

        propertyRegistry = PropertyRegistry(registryAddress);
        certificateNFT = IERC721(nftAddress);
        feeRecipient = payable(admin);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MANAGER_ROLE, admin);
    }

    function getTransactionFee(uint256 priceWei) public pure returns (uint256) {
        return (priceWei * FEE_BPS) / BPS_DENOMINATOR;
    }

    function getTotalPrice(uint256 priceWei) public pure returns (uint256) {
        return priceWei + getTransactionFee(priceWei);
    }

    function setFeeRecipient(address payable newFeeRecipient) external onlyRole(MANAGER_ROLE) {
        require(newFeeRecipient != address(0), "FEE_RECIPIENT_REQUIRED");
        feeRecipient = newFeeRecipient;
    }

    function _isEscrowApproved(address seller, uint256 tokenId) private view returns (bool) {
        return certificateNFT.getApproved(tokenId) == address(this)
            || certificateNFT.isApprovedForAll(seller, address(this));
    }

    function listCertificate(
        uint256 propertyId,
        uint256 priceWei,
        bytes32 backendTransactionId,
        bytes32 documentHash
    ) external nonReentrant returns (uint256 saleId) {
        return _listCertificate(propertyId, address(0), priceWei, backendTransactionId, documentHash);
    }

    function createCertificateSale(
        uint256 propertyId,
        address buyer,
        uint256 priceWei,
        bytes32 backendTransactionId,
        bytes32 documentHash
    ) external nonReentrant returns (uint256 saleId) {
        require(buyer != msg.sender, "BUYER_EQUALS_SELLER");
        if (buyer != address(0)) {
            require(propertyRegistry.isRegisteredWallet(buyer), "BUYER_NOT_REGISTERED");
        }
        return _listCertificate(propertyId, buyer, priceWei, backendTransactionId, documentHash);
    }

    function _listCertificate(
        uint256 propertyId,
        address reservedBuyer,
        uint256 priceWei,
        bytes32 backendTransactionId,
        bytes32 documentHash
    ) private returns (uint256 saleId) {
        require(priceWei > 0, "PRICE_REQUIRED");
        require(backendTransactionId != bytes32(0), "BACKEND_TX_REQUIRED");
        require(saleIdByBackendTransactionId[backendTransactionId] == 0, "BACKEND_TX_EXISTS");
        require(propertyRegistry.isPropertyActive(propertyId), "PROPERTY_INACTIVE");
        require(propertyRegistry.verifyOwnership(propertyId, msg.sender), "ONLY_PROPERTY_OWNER");
        require(activeSaleByProperty[propertyId] == 0, "ACTIVE_SALE_EXISTS");

        uint256 tokenId = propertyRegistry.getCertificateTokenId(propertyId);
        require(certificateNFT.ownerOf(tokenId) == msg.sender, "SELLER_NOT_NFT_HOLDER");

        saleId = nextSaleId++;
        certificateSales[saleId] = CertificateSale({
            id: saleId,
            propertyId: propertyId,
            certificateTokenId: tokenId,
            seller: msg.sender,
            buyer: reservedBuyer,
            priceWei: priceWei,
            backendTransactionId: backendTransactionId,
            documentHash: documentHash,
            status: SaleStatus.Listed,
            createdAt: block.timestamp,
            depositedAt: 0,
            releasedAt: 0,
            cancelledAt: 0,
            releasedBy: address(0)
        });

        activeSaleByProperty[propertyId] = saleId;
        saleIdsByProperty[propertyId].push(saleId);
        saleIdByBackendTransactionId[backendTransactionId] = saleId;

        require(_isEscrowApproved(msg.sender, tokenId), "NFT_NOT_APPROVED");

        emit CertificateSaleCreated(saleId, propertyId, msg.sender, reservedBuyer, priceWei, backendTransactionId);
        emit CertificateListed(saleId, propertyId, tokenId, msg.sender, priceWei);
    }

    function buyCertificate(uint256 saleId) external payable nonReentrant saleExists(saleId) {
        CertificateSale storage sale = certificateSales[saleId];
        require(sale.status == SaleStatus.Listed, "SALE_NOT_LISTED");
        require(msg.sender != sale.seller, "BUYER_EQUALS_SELLER");
        require(sale.buyer == address(0) || sale.buyer == msg.sender, "BUYER_NOT_ALLOWED");
        require(propertyRegistry.isRegisteredWallet(msg.sender), "BUYER_NOT_REGISTERED");
        require(propertyRegistry.verifyOwnership(sale.propertyId, sale.seller), "SELLER_NOT_PROPERTY_OWNER");
        require(certificateNFT.ownerOf(sale.certificateTokenId) == sale.seller, "SELLER_NOT_NFT_HOLDER");
        require(_isEscrowApproved(sale.seller, sale.certificateTokenId), "NFT_NOT_APPROVED");

        uint256 feeWei = getTransactionFee(sale.priceWei);
        uint256 totalPriceWei = sale.priceWei + feeWei;
        require(msg.value >= totalPriceWei, "INSUFFICIENT_PAYMENT");

        uint256 sellerProceedsWei = sale.priceWei;
        uint256 refundWei = msg.value - totalPriceWei;

        sale.buyer = msg.sender;
        sale.status = SaleStatus.Sold;
        sale.releasedAt = block.timestamp;
        sale.releasedBy = msg.sender;
        saleFeeWei[saleId] = feeWei;
        activeSaleByProperty[sale.propertyId] = 0;

        certificateNFT.safeTransferFrom(sale.seller, msg.sender, sale.certificateTokenId);
        propertyRegistry.updateOwnerFromEscrow(sale.propertyId, msg.sender);

        if (feeWei > 0) {
            (bool sentFee, ) = feeRecipient.call{value: feeWei}("");
            require(sentFee, "FEE_TRANSFER_FAILED");
        }

        (bool sentSeller, ) = payable(sale.seller).call{value: sellerProceedsWei}("");
        require(sentSeller, "SELLER_PAYMENT_FAILED");

        if (refundWei > 0) {
            (bool refunded, ) = payable(msg.sender).call{value: refundWei}("");
            require(refunded, "PAYMENT_REFUND_FAILED");
        }

        emit CertificatePurchased(
            saleId,
            sale.propertyId,
            sale.certificateTokenId,
            sale.seller,
            msg.sender,
            sale.priceWei,
            feeWei,
            sellerProceedsWei
        );
        emit CertificateReleased(saleId, sale.propertyId, msg.sender, msg.sender);
    }

    function depositCertificate(uint256 saleId) external payable nonReentrant saleExists(saleId) {
        CertificateSale memory sale = certificateSales[saleId];
        require(sale.status == SaleStatus.Listed, "SALE_NOT_LISTED");
        require(msg.sender == sale.seller, "ONLY_SELLER");
        require(msg.value == 0, "NO_FEE_ON_LISTING");
        require(certificateNFT.ownerOf(sale.certificateTokenId) == sale.seller, "SELLER_NOT_NFT_HOLDER");
        require(_isEscrowApproved(sale.seller, sale.certificateTokenId), "NFT_NOT_APPROVED");
    }

    function releaseCertificateToBuyer(uint256 saleId)
        external
        onlyRole(MANAGER_ROLE)
        nonReentrant
        saleExists(saleId)
    {
        revert("USE_BUY_CERTIFICATE");
    }

    function cancelCertificateSale(uint256 saleId) external nonReentrant saleExists(saleId) {
        CertificateSale storage sale = certificateSales[saleId];
        require(sale.status == SaleStatus.Listed, "SALE_CANNOT_BE_CANCELLED");
        require(msg.sender == sale.seller || hasRole(MANAGER_ROLE, msg.sender), "ONLY_SELLER_OR_MANAGER");

        sale.status = SaleStatus.Cancelled;
        sale.cancelledAt = block.timestamp;
        activeSaleByProperty[sale.propertyId] = 0;

        emit CertificateSaleCancelled(saleId, sale.propertyId);
    }

    function getCertificateSale(uint256 saleId) external view saleExists(saleId) returns (CertificateSale memory) {
        return certificateSales[saleId];
    }

    function getSalesByProperty(uint256 propertyId) external view returns (uint256[] memory) {
        return saleIdsByProperty[propertyId];
    }
}
