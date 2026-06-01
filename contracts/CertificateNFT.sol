// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

//tao NFT
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC721URIStorage,ERC721} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
//URI la 1 chuoi string thong tin xac nhan
//contract nay chi de duc NFT
//@notice 1 NFT dai dien cho 1 certificate cho 1 property
contract CertificateNFT is ERC721URIStorage, AccessControl{
    bytes32 public constant RegistryRole = keccak256("Registry Role");
    bytes32 public  constant EscrowRole = keccak256("Escrow Role");
    
    //tokenID => propertyID
    mapping(uint256 => uint256) public propertyID_ofToken;

    //dinh nghia ham mint NFT bang certificate, id tai san va id toknen, bao nhieu value
    event CertificateMinted(
    uint256 indexed propertyID,
    uint256 indexed tokenID,
    address indexed owner,
    string CertificateURI
    );

    //dinh nghia ham theo doi certificate
    event CertificateURIUpdate(
        uint256 indexed tokenID,
        string CertificateURI
    );

    //thiet lap NFT
    constructor (address admin) ERC721("Property Certificate NFT", "PCN"){
        require(admin != address(0), "Admin_Required"); //bao loi neu address=0
        _grantRole(DEFAULT_ADMIN_ROLE, admin); //chi cho admin 
    }

    //tao function de registry goi ham mint NFT cho first owner
    function mintCertificate(
        address to,
        uint256 tokenID,
        uint256 propertyID,
        string calldata CertificateURI
    ) external onlyRole(RegistryRole){
        require(to != address(0), "Owner_Required"); //dia chi nhan NFT khac 0.
        require(propertyID != uint256(0), "Property_Required");
        require(bytes(CertificateURI).length >0, "CertificateURI_Required");

        propertyID_ofToken[tokenID] = propertyID; //lien ket NFT = propety
        _safeMint(to, tokenID); //duc NFT co tokenID den dia chi nhan (to)
        _setTokenURI(tokenID, CertificateURI); 
        //xuat ham ra
        emit CertificateMinted(propertyID, tokenID, to, CertificateURI);
    } //chi cho nguoi dang ky tai san goi ham tao NFT

    //Registry update khi co new Certificate
    function UpdateCertificate(
        uint256 tokenID,
        string calldata CertificateURI
    ) external onlyRole(RegistryRole) {
        require(_ownerOf(tokenID) != address(0), "Token_not_Found");
        require(bytes(CertificateURI).length>0, "Certificate_not_Found");
        //dua token moi vao va xuat ra
        _setTokenURI(tokenID, CertificateURI);
        emit CertificateURIUpdate(tokenID,CertificateURI);
    }
    //@dev khong cho giao dich truc tiep giua cac user
    //chi de he thong giu NFT trong EscrowRole cho toi khi xac nhan giao dich hop le
    //@notice function nay la them luat cua minh khong de cac user tu y giao dich
    //_update la ham co san trong ERC721
    function _update(
        address to,
        uint256 tokenID,
        address authority //dia chi uy quyen
    ) internal override  returns (address) {
        address from = _ownerOf(tokenID);
        //from != 0 va to != 0 la normal transfer, khong phai mint
        if (from != address(0) && to != address(0)) {
            require(hasRole(EscrowRole, msg.sender), "Transfer_Only_Escrow");
        }
        return super._update(to, tokenID, authority);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721URIStorage, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

}