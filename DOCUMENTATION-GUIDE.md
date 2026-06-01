# DOCUMENTATION GUIDE - Sườn báo cáo Word cho dự án Blockchain

Tài liệu này dùng để chia việc cho team viết báo cáo Word theo phương án triển khai nâng cấp: Docker đóng gói cả Backend Node.js và PostgreSQL.

Tên đề tài gợi ý:

```text
Xây dựng hệ thống xác thực và chuyển nhượng quyền sở hữu nhà bằng Blockchain, NFT, Smart Contract, Node.js, PostgreSQL và Docker
```

---

## 1. Cấu trúc báo cáo đề xuất

```text
1. Bìa báo cáo
2. Mục lục
3. Giới thiệu đề tài
4. Lý do chọn đề tài
5. Mục tiêu và phạm vi
6. Cơ sở lý thuyết
7. Phân tích yêu cầu hệ thống
8. Kiến trúc hệ thống
9. Thiết kế cơ sở dữ liệu PostgreSQL
10. Thiết kế Smart Contract
11. Thiết kế Backend Node.js API
12. Docker và môi trường triển khai
13. Thiết kế Frontend
14. Quy trình demo sản phẩm
15. Kiểm thử và kết quả
16. Bảo mật, hạn chế và hướng phát triển
17. Kết luận
18. Phụ lục
```

---

## 2. Bảng PCCV - Phân công công việc cho 5 người

| STT | Thành viên | Vai trò chính | Công việc phải làm | Sản phẩm cần nộp |
|---|---|---|---|---|
| 1 | Thành viên 1 | Trưởng nhóm + tổng hợp báo cáo | Lập mục lục, chia việc, gom nội dung, chỉnh format Word, viết mở đầu/kết luận, kiểm tra tính thống nhất | File Word hoàn chỉnh, bìa, mục lục, kết luận, phụ lục |
| 2 | Thành viên 2 | Smart Contract | Giải thích `CertificateNFT.sol`, `PropertyRegistry.sol`, `PropertyTransactionEscrow.sol`, role, event, modifier, mapping, struct, escrow | Chương Smart Contract, bảng function, ảnh Remix, txHash, ảnh `ownerOf`/`verifyOwnership` |
| 3 | Thành viên 3 | Database + Docker PostgreSQL | Giải thích schema SQL, bảng, khóa chính/khóa ngoại, index, trigger, view; vẽ ERD bằng Draw.io | Chương Database, file/ảnh ERD Draw.io, screenshot pgAdmin/PostgreSQL container |
| 4 | Thành viên 4 | Backend Node.js + Docker backend | Giải thích Express API, `pg`, `ethers.js`, `.env`, Dockerfile, docker-compose, cách backend container kết nối PostgreSQL container | Chương Backend, chương Docker, bảng API, ảnh `/api/health`, ảnh Docker Desktop |
| 5 | Thành viên 5 | Frontend + Demo/Kiểm thử | Viết giao diện, MetaMask, fetch API; chuẩn bị demo, test case, ảnh transaction | Chương Frontend, chương Demo/Kiểm thử, ảnh giao diện, bảng test case |

Lưu ý:

- Thành viên 3 bắt buộc vẽ ERD bằng Draw.io.
- Thành viên 4 phải giải thích rõ vì sao backend trong Docker dùng `postgres:5432`, không dùng `localhost:5433`.
- Thành viên 5 chuẩn bị sẵn ví Admin, ví A, ví B, contract address, tokenId, propertyId, saleId.

---

## 3. Chương 1 - Giới thiệu đề tài

Nội dung cần viết:

- Bài toán xác thực quyền sở hữu nhà/đất.
- Vì sao cần minh bạch hóa quyền sở hữu và lịch sử chuyển nhượng.
- Vì sao NFT phù hợp với mô hình một giấy chứng nhận duy nhất.
- Vì sao vẫn cần backend và database ngoài blockchain.
- Vì sao Docker giúp demo/triển khai ổn định hơn.

Đoạn mẫu:

```text
Đề tài hướng đến việc xây dựng hệ thống xác thực quyền sở hữu nhà bằng blockchain. Mỗi bất động sản được đại diện bởi một NFT duy nhất, đóng vai trò như giấy chứng nhận số. Backend Node.js và PostgreSQL lưu trữ dữ liệu chi tiết, trong khi smart contract lưu bằng chứng sở hữu, hash dữ liệu và trạng thái chuyển nhượng quan trọng. Docker được sử dụng để đóng gói backend và database, giúp quá trình chạy demo và triển khai nhất quán hơn.
```

---

## 4. Chương 2 - Lý do chọn đề tài

Ý chính:

- Bất động sản là tài sản giá trị lớn.
- Quy trình xác minh/chuyển nhượng cần minh bạch.
- Blockchain giúp dữ liệu giao dịch khó bị sửa.
- NFT phù hợp với mô hình `1 property = 1 certificate = 1 NFT`.
- PostgreSQL phù hợp để lưu dữ liệu chi tiết như họ tên, CCCD, SĐT, quốc tịch.
- Docker giúp người khác chạy lại hệ thống dễ hơn mà không cần cài PostgreSQL thủ công.

Bảng so sánh:

| Cách truyền thống | Cách dùng Blockchain/NFT |
|---|---|
| Phụ thuộc nhiều vào giấy tờ vật lý | Có bằng chứng sở hữu on-chain |
| Khó tra cứu công khai | Có thể gọi `ownerOf` và `verifyOwnership` |
| Lịch sử chuyển nhượng phân tán | Lịch sử quan trọng có txHash/event |
| Dữ liệu cá nhân dễ lộ nếu công khai sai cách | Blockchain chỉ lưu hash, dữ liệu chi tiết ở backend |
| Môi trường cài đặt phụ thuộc từng máy | Docker đóng gói backend/database |

---

## 5. Chương 3 - Mục tiêu và phạm vi

### Mục tiêu

- Xây dựng 3 smart contract quản lý NFT certificate, property registry và escrow.
- Xây dựng PostgreSQL schema lưu dữ liệu chi tiết.
- Xây dựng backend Node.js API kết nối PostgreSQL và smart contract.
- Đóng gói backend và PostgreSQL bằng Docker.
- Xây dựng frontend kết nối MetaMask và gọi API.
- Demo được luồng chuyển quyền sở hữu từ A sang B.

### Phạm vi

- Hệ thống là mô hình học tập/demo.
- Chưa thay thế quy trình pháp lý/công chứng ngoài đời thật.
- Không lưu CCCD, SĐT, dữ liệu nhạy cảm trực tiếp lên blockchain.
- Demo trên Sepolia hoặc local chain.
- Mỗi bất động sản chỉ có 1 NFT đại diện cho 1 giấy chứng nhận.

---

## 6. Chương 4 - Cơ sở lý thuyết

Các mục cần có:

### 6.1 Blockchain

- Blockchain là sổ cái phân tán.
- Transaction sau khi ghi nhận sẽ khó sửa đổi.
- Mỗi transaction có hash.
- Smart contract là chương trình chạy trên blockchain.

### 6.2 Smart Contract Solidity

- `struct`: định nghĩa kiểu dữ liệu.
- `mapping`: ánh xạ dữ liệu.
- `modifier`: kiểm tra điều kiện trước khi chạy hàm.
- `event`: ghi log để backend/frontend theo dõi.
- `AccessControl`: phân quyền admin/manager/escrow.

### 6.3 NFT và ERC721

- NFT là token không thể thay thế.
- `ownerOf(tokenId)` cho biết chủ sở hữu NFT.
- Trong dự án, NFT đại diện cho giấy chứng nhận sở hữu.

### 6.4 Escrow

- Escrow là trung gian giữ NFT.
- Seller không chuyển trực tiếp cho buyer.
- Seller gửi NFT vào escrow.
- Admin xác minh.
- Escrow release NFT cho buyer.

### 6.5 Node.js, PostgreSQL và Docker

- Node.js backend cung cấp API.
- PostgreSQL lưu dữ liệu chi tiết.
- Docker đóng gói backend và database thành container.
- Docker Compose giúp chạy nhiều container cùng lúc trong cùng network.

---

## 7. Chương 5 - Phân tích yêu cầu hệ thống

### Tác nhân

| Tác nhân | Vai trò |
|---|---|
| Admin web | Xác minh hồ sơ, deploy/cấp role, release giao dịch |
| Chủ sở hữu A | Nhận NFT, tạo giao dịch bán, approve/deposit NFT |
| Người mua B | Nhận NFT sau khi giao dịch hợp lệ |
| Người xem/đơn vị kiểm tra | Gọi `ownerOf` hoặc `verifyOwnership` để xác minh |

### Yêu cầu chức năng

- Đăng ký cá nhân.
- Xác minh cá nhân.
- Đăng ký bất động sản.
- Mint NFT certificate.
- Tạo hồ sơ chuyển nhượng.
- Deposit NFT vào escrow.
- Release NFT cho người mua.
- Xem lịch sử sở hữu.
- Xác minh chủ sở hữu hiện tại.
- Chạy backend và PostgreSQL bằng Docker.

### Yêu cầu phi chức năng

- Dữ liệu nhạy cảm không đưa lên blockchain.
- API trả JSON rõ ràng.
- Giao dịch quan trọng có txHash.
- Có phân quyền smart contract.
- Môi trường demo chạy được bằng Docker Desktop.

---

## 8. Chương 6 - Kiến trúc hệ thống

Sơ đồ kiến trúc nên vẽ:

```text
Browser + MetaMask
        |
        v
Frontend
        |
        | fetch API
        v
Backend Node.js container
        |
        | pg
        v
PostgreSQL container

Backend Node.js container
        |
        | ethers.js + RPC_URL
        v
Smart Contracts
  - CertificateNFT
  - PropertyRegistry
  - PropertyTransactionEscrow
```

### Giải thích từng lớp

#### Frontend

- Giao diện người dùng.
- Kết nối MetaMask.
- Gọi backend API.
- Hiển thị profiles, properties, transfers.

#### Backend Node.js container

- Cung cấp API.
- Kết nối PostgreSQL container.
- Kiểm tra dữ liệu đầu vào.
- Gọi smart contract bằng `ethers.js` nếu là tác vụ admin.

#### PostgreSQL container

- Lưu dữ liệu cá nhân.
- Lưu dữ liệu bất động sản.
- Lưu hồ sơ chuyển nhượng.
- Lưu lịch sử sở hữu.

#### Smart Contract

- Lưu bằng chứng sở hữu.
- Mint NFT.
- Quản lý escrow.
- Cho phép xác minh owner on-chain.

### Sơ đồ luồng hoạt động nên vẽ bằng Draw.io

Nên vẽ dạng swimlane gồm:

| Swimlane | Nội dung |
|---|---|
| Frontend/MetaMask | User thao tác, ký giao dịch |
| Backend container | API, lưu database, gọi contract |
| PostgreSQL container | Lưu dữ liệu chi tiết |
| Smart Contract | Mint NFT, escrow, release |
| Blockchain/Testnet | Ghi transaction/event |

Luồng:

```text
Admin tạo/xác minh A và B
-> Admin đăng ký property cho A
-> Registry mint NFT cho A
-> A tạo sale
-> A approve NFT cho escrow
-> A deposit NFT vào escrow
-> Admin release NFT
-> B trở thành owner mới
-> Bất kỳ ai xác minh bằng ownerOf/verifyOwnership
```

---

## 9. Chương 7 - Thiết kế cơ sở dữ liệu PostgreSQL

### Docker trong phần database

Cần viết rõ PostgreSQL chạy bằng Docker container.

Đoạn mẫu:

```text
PostgreSQL được triển khai trong Docker container để tránh phụ thuộc vào cài đặt PostgreSQL trực tiếp trên máy. Khi backend cũng chạy trong Docker, backend và PostgreSQL nằm trong cùng Docker network, vì vậy backend kết nối database bằng host `postgres` và cổng nội bộ `5432`.
```

Khi backend chạy trong Docker:

```env
DATABASE_URL=postgres://postgres:gacon119@postgres:5432/postgres
```

Khi backend chạy ngoài Docker:

```env
DATABASE_URL=postgres://postgres:gacon119@localhost:5433/postgres
```

### ERD bằng Draw.io

Cần có file:

```text
Blockchain-ERD.drawio
Blockchain-ERD.png
```

Quan hệ cần thể hiện:

| Bảng nguồn | Khóa liên kết | Bảng đích | Ý nghĩa |
|---|---|---|---|
| profiles | id | property.owner_profile_id | Một cá nhân có thể sở hữu nhiều bất động sản |
| profiles | id | transfer_contract.seller_profile_id | Seller trong giao dịch |
| profiles | id | transfer_contract.buyer_profile_id | Buyer trong giao dịch |
| property | id | transfer_contract.property_id | Một property có nhiều hồ sơ giao dịch |
| property | id | property_ownership_history.property_id | Lịch sử đổi chủ |
| profiles | id | property_ownership_history.from_profile_id | Chủ cũ |
| profiles | id | property_ownership_history.to_profile_id | Chủ mới |
| contract_deployments | contract_address | contract_event_logs.contract_address | Event từ contract |
| profiles | id | activity_logs.actor_profile_id | Hành động user/admin |

### Các bảng chính

| Bảng | Mục đích |
|---|---|
| profiles | Lưu cá nhân: tên, CCCD, SĐT, quốc tịch, wallet |
| property | Lưu bất động sản và NFT certificate gắn với property |
| transfer_contract | Lưu hồ sơ giao dịch chuyển nhượng |
| property_ownership_history | Lưu lịch sử sở hữu |
| contract_deployments | Lưu địa chỉ contract đã deploy |
| contract_event_logs | Lưu event đọc từ blockchain |
| activity_logs | Lưu hành động user/admin |

Ảnh nên đưa vào:

- ERD Draw.io export PNG.
- Screenshot Docker Desktop có PostgreSQL container.
- Screenshot pgAdmin.
- Screenshot bảng profiles/property sau demo.

---

## 10. Chương 8 - Thiết kế Smart Contract

### 10.1 CertificateNFT.sol

- Kế thừa ERC721URIStorage và AccessControl.
- Mỗi NFT đại diện cho một certificate.
- `mintCertificate` chỉ RegistryRole được gọi.
- `UpdateCertificate` cập nhật URI.
- `_update` chặn transfer trực tiếp, chỉ EscrowRole được transfer.

### 10.2 PropertyRegistry.sol

- Lưu Person và Property.
- Admin/Manager register person.
- Verified wallet mới được làm owner ban đầu.
- Register property thì mint NFT.
- `verifyOwnership` cho phép xác minh chủ sở hữu.
- Escrow được gọi `updateOwnerFromEscrow`.

### 10.3 PropertyTransactionEscrow.sol

- Tạo sale.
- Seller deposit NFT vào escrow.
- Admin release NFT cho buyer.
- Cancel sale nếu chưa release.
- SaleStatus: Created, Deposited, Released, Cancelled.

---

## 11. Chương 9 - Backend Node.js API

Nội dung cần viết:

- Backend dùng Express.
- PostgreSQL kết nối bằng package `pg`.
- Smart contract kết nối bằng `ethers`.
- Backend đọc cấu hình từ `.env`.
- Backend được đóng gói và chạy trong Docker container.

API cần liệt kê:

| API | Mục đích |
|---|---|
| GET /api/health | Kiểm tra backend/database |
| GET /api/profiles | Lấy danh sách cá nhân |
| POST /api/profiles | Tạo cá nhân |
| GET /api/properties | Lấy danh sách property |
| POST /api/properties | Tạo property |
| GET /api/transfers | Lấy danh sách giao dịch |
| POST /api/transfers | Tạo hồ sơ giao dịch |
| GET /api/blockchain/status | Kiểm tra cấu hình blockchain |
| POST /api/blockchain/registry/register-person | Register person on-chain |
| POST /api/blockchain/registry/register-property | Register property và mint NFT |
| POST /api/blockchain/escrow/release | Admin release NFT cho buyer |

Ảnh nên đưa vào:

- Docker Desktop có backend container đang chạy.
- Terminal `docker logs blockchain-backend`.
- Browser `/api/health`.
- Browser `/api/blockchain/status`.
- Response JSON khi tạo profile/property.

---

## 12. Chương 10 - Docker và môi trường triển khai

Đây là chương quan trọng để lấy điểm Docker.

### 12.1 Docker đóng vai trò gì?

Docker đóng gói:

```text
Backend Node.js
PostgreSQL database
Docker network giữa backend và database
```

Không đóng gói:

```text
MetaMask
Remix
Blockchain/testnet
```

### 12.2 Vì sao cần Docker?

- Không cần cài PostgreSQL thủ công trên từng máy.
- Backend chạy cùng môi trường Node version.
- Dễ reset/chạy lại khi demo.
- Dễ chứng minh hệ thống có khả năng triển khai.
- Backend và database giao tiếp qua Docker network.

### 12.3 Cấu trúc file cần trình bày

```text
D:\Blockchain
  docker-compose.yml
  backend\
    Dockerfile
    .dockerignore
    package.json
    src\
```

### 12.4 Cách chạy demo bằng Docker

```powershell
cd D:\Blockchain
docker compose up -d --build
```

Kiểm tra:

```powershell
docker ps
docker logs blockchain-backend
docker logs blockchain-postgres
```

Mở:

```text
http://localhost:3000/api/health
```

### 12.5 Cấu hình biến môi trường

Khi backend trong Docker:

```env
DATABASE_URL=postgres://postgres:gacon119@postgres:5432/postgres
```

Nếu gọi local chain trên máy Windows:

```env
RPC_URL=http://host.docker.internal:8545
```

Nếu gọi Sepolia:

```env
RPC_URL=https://your-sepolia-rpc-url
```

---

## 13. Chương 11 - Thiết kế Frontend

Nội dung cần viết:

- Frontend dùng HTML/CSS/JavaScript hoặc framework nếu nhóm có.
- Kết nối MetaMask bằng `window.ethereum`.
- Gọi backend API bằng `fetch`.
- Không kết nối trực tiếp PostgreSQL.
- Không chứa private key admin.

Ảnh nên đưa vào:

- Dashboard.
- Nút kết nối MetaMask.
- Form tạo cá nhân.
- Form tạo bất động sản.
- Form chuyển nhượng.
- Kết quả JSON hoặc bảng dữ liệu.

---

## 14. Chương 12 - Quy trình demo sản phẩm

Luồng demo:

```text
Docker Desktop chạy backend + PostgreSQL
-> kiểm tra /api/health
-> deploy contract bằng Remix/MetaMask
-> điền contract address vào env
-> restart backend container
-> cấp role
-> register A/B
-> register property cho A
-> mint NFT
-> A tạo sale
-> A approve NFT
-> A deposit NFT vào escrow
-> Admin release
-> B là owner mới
```

Ảnh cần có:

- Docker Desktop backend/postgres running.
- `/api/health`.
- Remix deployed contracts.
- MetaMask transaction.
- `ownerOf` trước và sau release.
- Database transfer status.

---

## 15. Chương 13 - Kiểm thử

| Mã test | Nội dung | Kết quả mong muốn |
|---|---|---|
| TC01 | Chạy Docker backend + PostgreSQL | `/api/health` trả `ok: true` |
| TC02 | Tạo profile hợp lệ | Lưu vào `profiles` |
| TC03 | Register person on-chain | Có txHash |
| TC04 | Register property cho owner verified | Mint NFT thành công |
| TC05 | Register property cho owner chưa verified | Revert `OWNER_NOT_VERIFIED` |
| TC06 | User transfer NFT trực tiếp | Revert `TRANSFER_ONLY_ESCROW` |
| TC07 | Seller deposit NFT vào escrow | `ownerOf(tokenId) = escrow` |
| TC08 | Admin release NFT | `ownerOf(tokenId) = buyer` |
| TC09 | Backend container gọi local chain sai RPC localhost | Lỗi, phải dùng `host.docker.internal` |

---

## 16. Chương 14 - Bảo mật, hạn chế và hướng phát triển

### Bảo mật

- Không lưu dữ liệu nhạy cảm trực tiếp lên blockchain.
- Không đưa `ADMIN_PRIVATE_KEY` vào frontend.
- Không commit `.env`.
- Dùng AccessControl để phân quyền.
- Escrow ngăn user chuyển NFT trực tiếp.

### Hạn chế

- Demo chưa thay thế pháp lý/công chứng thật.
- Backend giữ private key admin cần bảo mật tốt.
- Cần event listener để đồng bộ blockchain tự động hơn.
- Cần lưu metadata certificate trên IPFS/storage rõ ràng.

### Hướng phát triển

- Thêm IPFS.
- Thêm event listener.
- Thêm frontend dashboard hoàn chỉnh.
- Thêm login/admin role.
- Thêm QR code verify certificate.
- Thêm unit test Hardhat.
- Hoàn thiện Docker Compose production/dev profile.

---

## 17. Kết luận

Đoạn mẫu:

```text
Dự án đã xây dựng mô hình xác thực và chuyển nhượng quyền sở hữu nhà bằng blockchain. NFT đại diện cho giấy chứng nhận sở hữu, smart contract quản lý owner và quy trình escrow, backend Node.js cung cấp API, PostgreSQL lưu dữ liệu chi tiết, còn Docker đóng gói backend và database để triển khai ổn định. Luồng demo cho thấy NFT có thể được chuyển từ seller sang buyer thông qua escrow sau khi admin xác minh.
```

---

## 18. Phụ lục

Nên đưa vào:

- Source code 3 smart contract.
- Schema SQL.
- Danh sách API backend.
- Dockerfile và docker-compose.yml.
- Screenshot Docker Desktop.
- Screenshot Remix/MetaMask.
- Screenshot transaction hash.
- ERD Draw.io.


## IPFS/Pinata trong dự án

Dự án dùng IPFS để lưu ảnh bất động sản và metadata NFT. Smart contract không lưu ảnh trực tiếp; NFT chỉ lưu `tokenURI/certificate_uri` dạng:

```text
ipfs://CID_METADATA
```

Luồng chạy:

```text
Frontend chọn ảnh tài sản
  -> Backend upload ảnh lên Pinata/IPFS
  -> PostgreSQL lưu image_cid, image_uri, gateway_url
  -> Backend tạo metadata JSON cho NFT
  -> Backend upload metadata JSON lên Pinata/IPFS
  -> PostgreSQL cập nhật property.certificate_uri = ipfs://CID_METADATA
  -> Khi mint NFT, dùng certificate_uri này làm tokenURI
```

Cần cấu hình trong `backend/.env`:

```env
PINATA_JWT=your_pinata_jwt_here
IPFS_GATEWAY=https://gateway.pinata.cloud/ipfs/
MAX_UPLOAD_BYTES=10485760
```

Sau khi đổi `.env`, restart backend:

```powershell
docker compose restart backend
```

Nếu database đã tồn tại trước khi thêm IPFS, backend sẽ tự tạo bảng `property_images` khi gọi API IPFS. Có thể chạy thủ công file:

```text
backend/PostgreSQL/ipfs_migration.sql
```

Lưu ý bảo mật: không upload CCCD, số điện thoại, hợp đồng gốc chưa che thông tin lên IPFS public. IPFS phù hợp cho ảnh công khai và metadata NFT; tài liệu nhạy cảm chỉ nên lưu hash hoặc file đã mã hóa.
