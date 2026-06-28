# Frontend Demo

Frontend này là dashboard demo cho dự án xác thực/chuyển nhượng quyền sở hữu bất động sản bằng NFT.

## Chạy nhanh

```powershell
cd D:\Blockchain\frontend
npx serve .
```

Hoặc mở `index.html` bằng VS Code Live Server.

## Cần chạy trước

1. Backend ở `http://localhost:3000`.
2. PostgreSQL đã có schema.
3. MetaMask cài trong Chrome.
4. Sau khi deploy smart contract, backend `.env` đã có:

```env
NFT_ADDRESS=0x...
REGISTRY_ADDRESS=0x...
ESCROW_ADDRESS=0x...
RPC_URL=...
ADMIN_PRIVATE_KEY=...
```

## Chỉnh giao diện

- Màu chính: sửa `--accent`, `--accent-bright` trong `styles.css`.
- Nền và hiệu ứng sáng: sửa `.blob-primary`, `.blob-secondary`, `.blob-tertiary`.
- Bo góc: sửa `--radius-lg`, `--radius-md`.
- Địa chỉ dịch vụ API: đổi trong phần **Cấu hình kết nối** trên màn hình đăng nhập.


## Điều hướng nhiều màn hình

Frontend dùng hash route, ví dụ:

- `#/home`: tổng quan
- `#/profiles`: cá nhân
- `#/properties`: bất động sản
- `#/transfers`: giao dịch
- `#/verify`: xác thực
- `#/system`: cấu hình hệ thống, chỉ hiện khi bật Admin

Đây vẫn là frontend tĩnh, nhưng người dùng sẽ thấy như đang chuyển trang.

## User view và Admin view

Mặc định giao diện chạy ở quyền user và không hiển thị khu vực quản trị.

- User: tạo hồ sơ, tự ghi person on-chain, tạo tài sản, upload metadata IPFS, mint NFT vào ví của mình, ký bán, approve/deposit NFT vào escrow và trả phí 0.01%.
- Admin: hiện thêm khu vực quản trị, cấu hình hệ thống, cấp role contract và vẫn có thể hỗ trợ các thao tác quản trị cần thiết.

Lưu ý: frontend chỉ là lớp hiển thị. Backend vẫn dùng JWT và role để chặn API quản trị.

## Người từ máy khác truy cập

Nếu máy khác cùng mạng LAN muốn mở frontend:

1. Máy chạy backend phải mở port `3000`.
2. Frontend trên máy user phải trỏ API backend về IP máy chạy backend, ví dụ:

```text
http://192.168.1.10:3000
```

Không dùng `localhost:3000` trên máy user, vì `localhost` là chính máy user, không phải máy đang chạy backend.


## Đăng nhập và phân quyền

Frontend đăng nhập bằng chữ ký ví MetaMask. Backend verify chữ ký rồi cấp JWT nội bộ để phân quyền API:

- `admin`: thấy khu vực quản trị và được gọi các API quản trị như cấu hình contract/cấp role.
- `user`: không thấy khu vực quản trị, nhưng có thể tự tạo tài sản, mint NFT, ký bán và thao tác escrow bằng MetaMask.

Lần đầu chạy hệ thống, phần **Khởi tạo tài khoản quản trị đầu tiên** chỉ hiện khi backend chưa có admin và sẽ yêu cầu ký bằng ví MetaMask.

Sau khi có ví admin đầu tiên, các ví khác đăng nhập thành công sẽ tự được backend tạo tài khoản nội bộ với quyền `user`.

Lưu ý: flow user tự mint và phí escrow 0.01% yêu cầu deploy lại `PropertyRegistry` và `PropertyTransactionEscrow` sau khi cập nhật contract.

## Mở link cho máy khác trong cùng mạng

Chạy frontend lắng nghe mọi IP:

```powershell
cd D:\Blockchain\frontend
npx.cmd serve . -l tcp://0.0.0.0:5173
```

Máy khác mở:

```text
http://IP_MAY_CUA_BAN:5173
```

Trong phần **Cấu hình kết nối** trên màn hình đăng nhập, nhập:

```text
http://IP_MAY_CUA_BAN:3000
```

Không nhập `localhost:3000` trên máy khác, vì `localhost` là chính máy đó.


## Chạy frontend bằng Docker

Khi dùng `docker compose`, frontend chạy ở:

```text
http://localhost:5173
```

Máy khác cùng mạng dùng:

```text
http://IP_MAY_BAN:5173
```

Frontend sẽ tự gợi ý địa chỉ dịch vụ API theo hostname đang mở, ví dụ nếu mở `http://192.168.1.10:5173` thì API mặc định là `http://192.168.1.10:3000`.


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
