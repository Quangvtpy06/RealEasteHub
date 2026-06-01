# README DEMO - Property Chain

Tài liệu này dùng để chạy demo sản phẩm hiện tại của dự án **Property Chain**: hệ thống xác thực và chuyển nhượng quyền sở hữu bất động sản bằng NFT, kết hợp Smart Contract, Node.js Backend, PostgreSQL, Docker, MetaMask, Pinata/IPFS và Frontend Web3.

> Lưu ý khi demo: tuyệt đối không mở file `.env`, không chiếu private key, Pinata JWT, ngrok authtoken hoặc ví thật có tài sản thật. Chỉ dùng Sepolia/testnet.

## 1. Trạng thái hiện tại của dự án

### 1.1. Mục tiêu sản phẩm

Hệ thống mô phỏng quy trình:

1. Admin quản lý hồ sơ cá nhân và bất động sản.
2. Người dùng đăng nhập bằng ví MetaMask.
3. Tài sản có thể lưu hình ảnh lên IPFS thông qua Pinata.
4. Mỗi bất động sản có một giấy chứng nhận sở hữu được biểu diễn bằng một NFT ERC721.
5. Khi chuyển nhượng, NFT đi qua smart contract trung gian Escrow trước khi chuyển cho người mua.
6. Frontend có trang tài sản, cá nhân, giao dịch, sổ giao dịch, profile ví, tìm kiếm NFT/người dùng.

### 1.2. Kiến trúc chạy demo

```text
Người dùng / MetaMask
        |
        v
Frontend Web3 - http://localhost:5173 hoặc URL ngrok
        |
        | /api/* được nginx proxy nội bộ
        v
Backend Node.js - Express API
        |
        +--> PostgreSQL trong Docker: lưu hồ sơ, tài sản, giao dịch, ảnh, metadata, event
        |
        +--> Pinata/IPFS: lưu ảnh tài sản và metadata NFT
        |
        +--> Sepolia RPC: gọi 3 smart contract đã deploy
```

### 1.3. Các phần chính

| Thành phần | Vai trò |
|---|---|
| `contracts/CertificateNFT.sol` | Đúc và quản lý NFT giấy chứng nhận sở hữu. |
| `contracts/PropertyRegistry.sol` | Quản lý dữ liệu on-chain của cá nhân, bất động sản, chủ sở hữu hiện tại. |
| `contracts/PropertyTransactionEscrow.sol` | Trung gian giữ NFT và xác nhận chuyển nhượng cho người mua. |
| `backend/src/server.js` | API chính cho frontend, database, IPFS và smart contract. |
| `backend/src/services/contracts.js` | Kết nối backend với smart contract bằng `ethers`. |
| `backend/src/services/ipfs.js` | Upload ảnh/metadata lên Pinata IPFS. |
| `backend/PostgreSQL/schema.sql` | Schema PostgreSQL cho hồ sơ, tài sản, giao dịch, contract, log, IPFS. |
| `frontend/index.html`, `frontend/app.js`, `frontend/styles.css` | Giao diện Web3, đăng nhập bằng ví, profile drawer, NFT gallery, search. |
| `docker-compose.yml` | Chạy PostgreSQL, backend, frontend cùng lúc bằng Docker. |
| `frontend/nginx.conf` | Cho frontend proxy `/api` sang backend để chỉ cần một domain khi public bằng ngrok. |

## 2. Yêu cầu trước khi chạy demo

### 2.1. Phần mềm cần có

- Docker Desktop đang chạy.
- MetaMask trên Chrome/Edge.
- Ví testnet có ETH Sepolia để trả phí gas.
- Remix Desktop hoặc Remix IDE nếu cần deploy lại contract.
- Ngrok nếu muốn cho máy khác hoặc mạng khác truy cập web demo.
- Tài khoản Pinata nếu muốn upload ảnh/metadata IPFS.
- RPC Sepolia, ví dụ Infura/Alchemy.

### 2.2. File cấu hình cần kiểm tra

Mở `backend/.env` và kiểm tra đã có các biến sau. Không đưa giá trị thật vào báo cáo hoặc khi trình chiếu:

```env
PORT=3000
DATABASE_URL=...

RPC_URL=...
CHAIN_ID=11155111
NFT_ADDRESS=...
REGISTRY_ADDRESS=...
ESCROW_ADDRESS=...
ADMIN_PRIVATE_KEY=...

JWT_SECRET=...
JWT_EXPIRES_IN=...

PINATA_JWT=...
IPFS_GATEWAY=https://gateway.pinata.cloud/ipfs/
MAX_UPLOAD_BYTES=10485760
```

Ý nghĩa nhanh:

- `RPC_URL`: đường dẫn node Sepolia để backend gửi transaction.
- `CHAIN_ID`: mã mạng blockchain, Sepolia là `11155111`.
- `NFT_ADDRESS`, `REGISTRY_ADDRESS`, `ESCROW_ADDRESS`: địa chỉ 3 smart contract đã deploy.
- `ADMIN_PRIVATE_KEY`: private key của ví testnet dùng cho backend ký transaction on-chain.
- `PINATA_JWT`: token để backend upload file lên Pinata.
- `IPFS_GATEWAY`: gateway dùng để đọc ảnh/metadata từ IPFS.
- `DATABASE_URL`: khi chạy bằng Docker Compose, compose tự trỏ backend vào container PostgreSQL.

## 3. Chạy demo local bằng Docker

### 3.1. Chạy toàn bộ hệ thống

Mở PowerShell tại thư mục dự án:

```powershell
cd D:\Blockchain
docker compose up -d --build
```

Lệnh này sẽ build và chạy 3 container:

- `blockchain-postgres`: PostgreSQL.
- `blockchain-backend`: Node.js API.
- `blockchain-frontend`: giao diện web qua nginx.

Kiểm tra container:

```powershell
docker ps
```

Kỳ vọng thấy đủ 3 container trên.

### 3.2. Kiểm tra backend và frontend

Mở trình duyệt:

```text
http://localhost:5173
http://localhost:5173/api/health
```

Nếu `/api/health` trả JSON có trạng thái OK nghĩa là frontend đã proxy được tới backend.

### 3.3. Xem log khi lỗi

```powershell
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f postgres
```

Sau khi sửa `backend/.env`, restart backend:

```powershell
docker compose restart backend
```

Nếu sửa frontend rồi build lại:

```powershell
docker compose up -d --build frontend
```

## 4. Public demo cho máy khác bằng một URL ngrok

Vì frontend nginx đã proxy `/api` sang backend, chỉ cần public **một endpoint**:

```powershell
ngrok http 5173
```

Ngrok sẽ trả URL dạng:

```text
https://ten-ngau-nhien.ngrok-free.app
```

Gửi URL này cho máy khác. Không cần chạy thêm `ngrok http 3000`.

Nếu máy khác mở được trang nhưng gọi API lỗi:

1. Kiểm tra Docker vẫn chạy.
2. Mở thử `https://ten-ngau-nhien.ngrok-free.app/api/health`.
3. Trong frontend, nếu từng lưu API base cũ, đổi API base về chính domain hiện tại hoặc xóa cache/localStorage.
4. Bấm `Ctrl + F5` để tải lại file JS/CSS mới.

## 5. Deploy hoặc kiểm tra smart contract

Nếu đã deploy contract rồi và địa chỉ trong `.env` còn đúng thì **không cần deploy lại mỗi lần demo**. Chỉ cần chạy Docker, backend sẽ dùng lại các contract address đó.

Chỉ cần deploy lại khi:

- Sửa code `.sol`.
- Mất địa chỉ contract cũ.
- Deploy nhầm network.
- Contract cũ thiếu role hoặc dữ liệu test bị rối và muốn làm lại từ đầu.

### 5.1. Thứ tự deploy khuyến nghị trên Remix

1. Deploy `CertificateNFT`.
2. Deploy `PropertyRegistry`, truyền vào địa chỉ `CertificateNFT`.
3. Deploy `PropertyTransactionEscrow`, truyền vào địa chỉ `CertificateNFT` và `PropertyRegistry`.
4. Copy 3 contract address vào `backend/.env`.
5. Restart backend.

### 5.2. Cấp role bắt buộc

Sau khi deploy, cần cấp quyền để các contract gọi nhau:

1. Trong `CertificateNFT`, gọi `RegistryRole()` để lấy role bytes32, sau đó `grantRole(role, REGISTRY_ADDRESS)`.
2. Trong `CertificateNFT`, gọi `EscrowRole()` để lấy role bytes32, sau đó `grantRole(role, ESCROW_ADDRESS)`.
3. Trong `PropertyRegistry`, gọi `ESCROW_ROLE()` rồi `grantRole(role, ESCROW_ADDRESS)`.

Kiểm tra bằng:

```text
hasRole(role, account)
```

Nếu trả `true` là role đã cấp đúng.

## 6. Luồng demo sản phẩm trên web

### 6.1. Đăng nhập Web3

1. Mở web local hoặc URL ngrok.
2. Chọn đăng nhập bằng MetaMask.
3. MetaMask yêu cầu ký thông điệp đăng nhập.
4. Sau khi ký thành công, web vào giao diện chính và tự nhận ví đang kết nối.

Không dùng đăng nhập username/password cho người dùng thường. Đây là web3 login bằng ví.

### 6.2. Tạo hồ sơ cá nhân

Vào trang **Cá nhân**:

1. Nhập họ tên, CCCD, số điện thoại, quốc tịch, địa chỉ, ví MetaMask.
2. Tạo hồ sơ.
3. Admin xác minh hồ sơ nếu cần.
4. Nếu muốn ghi nhận on-chain, dùng chức năng đăng ký/xác minh person on-chain.

Lưu ý: ví chủ sở hữu phải được xác minh trước khi mint NFT, nếu không contract có thể báo `OWNER_NOT_VERIFIED`.

### 6.3. Tạo bất động sản và upload ảnh IPFS

Vào trang **Bất động sản**:

1. Chọn chủ sở hữu từ hồ sơ đã tạo.
2. Nhập thông tin bất động sản.
3. Upload hình ảnh tài sản.
4. Backend upload ảnh lên Pinata/IPFS và lưu CID/gateway URL trong PostgreSQL.
5. Có thể tạo metadata NFT từ dữ liệu tài sản và ảnh IPFS.

Ảnh sẽ hiển thị ở gallery NFT, trang tài sản, profile drawer và sổ sở hữu nếu gateway đọc được.

### 6.4. Mint NFT giấy chứng nhận

Sau khi bất động sản có chủ sở hữu hợp lệ:

1. Bấm chức năng ghi nhận/mint NFT on-chain.
2. Backend gọi `PropertyRegistry.registerProperty(...)`.
3. `PropertyRegistry` gọi `CertificateNFT.mintCertificate(...)`.
4. NFT được mint cho ví chủ sở hữu.
5. Database cập nhật `blockchain_property_id`, `certificate_token_id`, transaction hash.

Kết quả:

- Mỗi bất động sản có một NFT giấy chứng nhận.
- Người sở hữu NFT là người sở hữu bất động sản trên hệ thống.

### 6.5. Xem NFT, profile và tìm kiếm

Trên trang chủ:

- Hiển thị các NFT giấy chứng nhận đang có.
- Có ảnh nếu tài sản đã upload IPFS.
- Có thanh tìm kiếm `Search NFT or User` để tìm NFT hoặc người dùng.

Ở góc ví:

- Bấm avatar ví để mở profile drawer bên phải.
- Drawer hiển thị NFT đang sở hữu, token, lịch sử giao dịch.
- Trang `Profile` hiển thị dữ liệu tương tự ở dạng trang đầy đủ.

### 6.6. Chuyển nhượng NFT qua Escrow

Luồng demo chuyển nhượng:

1. Tạo giao dịch chuyển nhượng, chọn tài sản, seller, buyer, giá.
2. Backend hoặc frontend tạo sale trên Escrow.
3. Seller approve NFT cho Escrow.
4. Seller deposit NFT vào Escrow.
5. Hệ thống đánh dấu đã ký gửi.
6. Admin xác nhận chuyển nhượng/release.
7. Escrow chuyển NFT cho buyer.
8. Registry cập nhật chủ sở hữu mới.
9. Sổ giao dịch ghi lại lịch sử.

Sau khi hoàn tất, kiểm tra:

- Trang **Sổ giao dịch** có lịch sử chuyển nhượng.
- Danh sách sở hữu NFT chuyển sang ví buyer.
- Profile drawer của buyer hiển thị NFT mới.

## 7. Các lỗi thường gặp khi demo

### 7.1. `AUTH_REQUIRED`

Nguyên nhân: gọi API cần quyền admin hoặc cần token đăng nhập.

Cách xử lý:

- Đăng nhập bằng MetaMask trước.
- Kiểm tra ví đang dùng có role admin trong hệ thống web hay chưa.
- Nếu gọi bằng Postman, cần gửi header `Authorization: Bearer <token>`.

### 7.2. `RPC_URL is required`

Backend chưa có `RPC_URL` hoặc Docker chưa restart sau khi sửa `.env`.

Cách xử lý:

```powershell
docker compose restart backend
```

Sau đó kiểm tra lại `/api/blockchain/status`.

### 7.3. `OWNER_NOT_VERIFIED`

Ví chủ sở hữu chưa được xác minh on-chain trong `PropertyRegistry`.

Cách xử lý:

1. Tạo profile đúng địa chỉ ví owner.
2. Register person on-chain.
3. Verify person on-chain.
4. Mint lại property/NFT.

### 7.4. `unknown custom error` khi mint hoặc release

Thường do thiếu role giữa các contract hoặc contract address trong `.env` không khớp contract đã deploy.

Cách xử lý:

- Kiểm tra `NFT_ADDRESS`, `REGISTRY_ADDRESS`, `ESCROW_ADDRESS`.
- Kiểm tra `hasRole(role, account)` trong Remix.
- Cấp lại role cho đúng contract address.
- Restart backend.

### 7.5. Pinata lỗi `401 INVALID_CREDENTIALS`

Pinata JWT sai, copy nhầm API Secret thay vì JWT, hoặc key bị revoke.

Cách xử lý:

1. Vào Pinata > API Keys.
2. Tạo key mới có quyền upload/read.
3. Copy đúng dòng `JWT`.
4. Dán vào `PINATA_JWT`.
5. Restart backend.

### 7.6. Ảnh IPFS không hiện

Nguyên nhân có thể là gateway chậm, URL sai, ảnh chưa upload thành công, hoặc frontend đang cache dữ liệu cũ.

Cách xử lý:

- Mở trực tiếp gateway URL trong trình duyệt.
- Kiểm tra bảng ảnh tài sản trong database.
- Bấm tải lại dữ liệu trên frontend.
- Bấm `Ctrl + F5`.

### 7.7. Máy khác không vào được web

Nếu dùng `localhost`, chỉ máy của bạn vào được.

Cách xử lý:

- Cùng mạng LAN: dùng IP LAN của máy bạn, ví dụ `http://192.168.x.x:5173`, đồng thời mở firewall nếu cần.
- Khác mạng: dùng `ngrok http 5173` và gửi URL HTTPS của ngrok.

### 7.8. Ngrok báo chỉ chạy được một endpoint

Với demo hiện tại, chỉ public frontend:

```powershell
ngrok http 5173
```

Không cần public backend riêng vì `/api` đã được nginx proxy.

## 8. Checklist trước khi lên lớp demo

### 8.1. Kiểm tra kỹ thuật

- [ ] Docker Desktop đang chạy.
- [ ] `docker ps` có `blockchain-postgres`, `blockchain-backend`, `blockchain-frontend`.
- [ ] `http://localhost:5173/api/health` trả OK.
- [ ] MetaMask đang ở Sepolia.
- [ ] Ví admin có ETH testnet.
- [ ] 3 contract address trong `.env` đúng với network Sepolia.
- [ ] Backend đã restart sau khi sửa `.env`.
- [ ] Pinata upload thử thành công.
- [ ] Ngrok public đúng port `5173` nếu cần máy khác truy cập.
- [ ] Không chiếu private key/JWT/authtoken.

### 8.2. Checklist dữ liệu demo

- [ ] Có ít nhất 2 hồ sơ: seller và buyer.
- [ ] Seller đã được xác minh.
- [ ] Có ít nhất 1 bất động sản có ảnh IPFS.
- [ ] NFT đã mint thành công cho seller.
- [ ] Có ví buyer để nhận NFT.
- [ ] Đã chuẩn bị sẵn ETH Sepolia cho phí gas.

### 8.3. Kịch bản nói nhanh trước lớp

1. Giới thiệu vấn đề: xác thực sở hữu bất động sản cần minh bạch và có thể kiểm tra.
2. Giới thiệu kiến trúc: frontend, backend, PostgreSQL, IPFS, smart contract.
3. Đăng nhập bằng MetaMask để chứng minh định danh ví.
4. Tạo hồ sơ và bất động sản.
5. Upload ảnh lên IPFS.
6. Mint NFT giấy chứng nhận.
7. Tìm kiếm NFT/người dùng và xem profile.
8. Thực hiện chuyển nhượng qua Escrow.
9. Mở sổ giao dịch để chứng minh lịch sử và chủ sở hữu mới.
10. Kết luận: database lưu dữ liệu phục vụ web, blockchain lưu bằng chứng và quyền sở hữu NFT.

## 9. Ghi chú bảo mật và phạm vi đề tài

- Đây là dự án học tập, không thay thế công chứng/pháp lý thật.
- Không lưu thông tin nhạy cảm thô lên blockchain hoặc IPFS.
- IPFS là public nếu không mã hóa dữ liệu.
- Blockchain chỉ nên lưu hash, địa chỉ ví, id on-chain và trạng thái cần chứng minh.
- PostgreSQL lưu dữ liệu chi tiết để frontend/backend xử lý nghiệp vụ.
- Private key backend chỉ dùng ví testnet, không dùng ví chính.
