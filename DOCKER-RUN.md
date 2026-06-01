# Chạy dự án bằng Docker

Tài liệu này dùng khi muốn Docker Desktop chạy toàn bộ phần app demo:

- PostgreSQL container: lưu dữ liệu SQL.
- Backend Node.js container: cung cấp API, kết nối PostgreSQL, gọi smart contract.
- Frontend container: giao diện web tĩnh chạy bằng Nginx.

MetaMask, Remix và blockchain/testnet vẫn chạy bên ngoài Docker.

## 1. Kiểm tra file cần có

```text
D:\Blockchain
  docker-compose.yml
  .dockerignore

  backend\
    Dockerfile
    .env
    package.json
    src\
    PostgreSQL\schema.sql

  frontend\
    Dockerfile
    nginx.conf
    index.html
    app.js
    styles.css
```

## 2. Cấu hình backend/.env

File `backend/.env` vẫn dùng để lưu cấu hình blockchain:

```env
PORT=3000
DATABASE_URL=postgres://postgres:gacon119@localhost:5433/postgres

RPC_URL=https://your-sepolia-rpc-url
CHAIN_ID=11155111
NFT_ADDRESS=0x...
REGISTRY_ADDRESS=0x...
ESCROW_ADDRESS=0x...
ADMIN_PRIVATE_KEY=private_key_testnet_cua_admin
JWT_SECRET=...
JWT_EXPIRES_IN=8h
```

Khi chạy trong Docker, `docker-compose.yml` sẽ tự override `DATABASE_URL` thành:

```env
DATABASE_URL=postgres://postgres:gacon119@postgres:5432/postgres
```

Lý do: trong Docker network, backend gọi PostgreSQL bằng service name `postgres`, không dùng `localhost`.

## 3. Chạy Docker

Mở Docker Desktop trước, sau đó chạy:

```powershell
cd D:\Blockchain
docker compose up -d --build
```

Kiểm tra container:

```powershell
docker ps
```

Kết quả mong muốn:

```text
blockchain-postgres    5433->5432
blockchain-backend     3000->3000
blockchain-frontend    5173->80
```

## 4. Mở web

Trên máy của bạn:

```text
http://localhost:5173
```

Backend:

```text
http://localhost:3000/api/health
```

## 5. Tạo admin lần đầu

Khi mở frontend lần đầu:

1. Chọn phần tạo admin đầu tiên.
2. Nhập username/password.
3. Bấm tạo admin.
4. Sau khi đăng nhập, vào `System` để tạo thêm tài khoản user.

## 6. Cho máy khác cùng mạng truy cập

Trên máy chạy Docker, lấy IPv4:

```powershell
ipconfig
```

Ví dụ IP là:

```text
192.168.1.10
```

Máy khác mở:

```text
http://192.168.1.10:5173
```

Ở màn hình login, ô API backend nhập:

```text
http://192.168.1.10:3000
```

Không dùng `localhost:3000` trên máy khác, vì `localhost` là chính máy đó.

## 7. Lệnh thường dùng

Xem log backend:

```powershell
docker logs blockchain-backend
```

Xem log PostgreSQL:

```powershell
docker logs blockchain-postgres
```

Restart backend sau khi đổi contract address:

```powershell
docker compose restart backend
```

Dừng toàn bộ:

```powershell
docker compose down
```

Dừng và xóa database volume để tạo database mới từ `schema.sql`:

```powershell
docker compose down -v
docker compose up -d --build
```

Chỉ dùng `down -v` khi bạn chấp nhận xóa toàn bộ dữ liệu demo trong PostgreSQL container.

## 8. Lỗi thường gặp

### Port 5433 bị chiếm

Nếu container cũ tên `demo` đang dùng port 5433:

```powershell
docker stop demo
```

Hoặc đổi port trong `docker-compose.yml`.

### Frontend mở được nhưng API lỗi

Kiểm tra ô API backend:

- Trên máy bạn: `http://localhost:3000`
- Máy khác cùng mạng: `http://IP_MAY_BAN:3000`

### Backend không gọi được local blockchain

Nếu Hardhat/Ganache chạy trên Windows ở port 8545, trong `.env` dùng:

```env
RPC_URL=http://host.docker.internal:8545
```

Không dùng:

```env
RPC_URL=http://localhost:8545
```


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

## Chạy public bằng một domain ngrok

Frontend container hiện đóng vai trò reverse proxy cho backend:

```text
https://<domain-ngrok>
  -> frontend nginx
  -> /api/* được chuyển nội bộ sang backend:3000
```

Vì vậy khi demo cho máy khác, chỉ cần public frontend:

```powershell
ngrok http 5173
```

Sau đó mở đúng link `Forwarding` của ngrok. Không cần mở thêm tunnel riêng cho backend. Trên web, phần "Địa chỉ dịch vụ API" có thể để mặc định chính domain hiện tại, ví dụ:

```text
https://xxxxx.ngrok-free.app
```

Nếu trình duyệt từng lưu API cũ dạng `localhost:3000` hoặc một link backend ngrok khác, hãy mở "Cấu hình kết nối" và đổi lại thành chính link frontend ngrok hiện tại.

