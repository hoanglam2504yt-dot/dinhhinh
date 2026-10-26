# DETAILED LOGIC - BATCH IMPORT LAYERS (MÔ TẢ CHI TIẾT)

## MỤC ĐÍCH & PHẠM VI
Script tự động hóa quy trình chuyển đổi ảnh sticker / phôi định hình (raster) thành artwork vector trong **Adobe Illustrator**, sau đó sắp xếp tối ưu các artwork này lên artboard theo thuật toán **Bin-Packing (Smart Packer)**. 

Hệ thống tự động thực hiện xuyên suốt các tác vụ:
- Xử lý ảnh, Image Trace và tách lọc Path thông minh.
- Tạo đường cắt bế **Kiss-cut** và **Die-cut** chuẩn màu in CMYK.
- Quản lý luồng dữ liệu tự động qua các thư mục (`image-done`, `image-error`, `wait`, `note_done`, `note_work`).

---

## PHÂN ĐOẠN CHI TIẾT (STEP-BY-STEP)

### 1. Khởi tạo (Initialization)
- **Thiết lập các đường dẫn mặc định:**
  - `OUT_TEMPLATE`, `IMAGE_FOLDER`, `IMAGE_DONE_FOLDER`, `IMAGE_ERROR_FOLDER`
  - `OUTPUT_FOLDER`, `NOTE_DONE_FOLDER`, `WAIT_FOLDER`, `WAIT_META_FOLDER`, `NOTEWORKFOLDER`
- **Thiết lập tham số hệ thống:**
  - Khoảng cách & lề: `GAP_MM` ($5\text{ mm}$), `MARGIN_MM` ($3\text{ mm}$)
  - Tùy chọn: `ALLOW_ROTATE` (`true`), `FAST_MODE` (`true`, tối ưu thời gian nghỉ `sleep`)
  - Cấu hình Action: `ACTION_SET` (`"My set"`), `ACTION_MERGE` (`"Merge"`), `ACTION_UNITE` (`"Unite"`), `ACTION_COLOR_BALANCE` (`"ColorBalanceKiss"`).
- **Trạng thái tương tác:** Lưu `OLD_USER_INTERACTION_LEVEL = app.userInteractionLevel` để đảm bảo khôi phục nguyên trạng mức tương tác người dùng sau khi kết thúc script.

### 2. Chế độ tiếp tục (Resume / Wait Mode)
- Kiểm tra thư mục `WAIT_FOLDER` xem có tồn tại file chờ `_wait_` nào không (ví dụ: `name_wait_5.ai`).
- **Nếu có file wait:**
  - Kích hoạt `RUN_WAIT_MODE = true`.
  - Mở file wait và nạp dữ liệu vùng đã xếp (`usedRects`) từ file `.json` tương ứng trong `WAIT_META_FOLDER`.
- **Nếu không có file wait:**
  - Mở file mẫu chuẩn `template_saved.ai` từ thư mục `OUT_TEMPLATE`.
- Tạo file ghi nhận trạng thái hoạt động tạm thời `working.txt` trong thư mục `note_work`.

### 3. Đọc & Khởi tạo danh sách công việc (Read & Create Jobs)
- Quét toàn bộ file hợp lệ trong `IMAGE_FOLDER` (`.jpg`, `.jpeg`, `.png`, `.tif`, `.tiff`, `.bmp`, `.psd`, `.ai`).
- Bỏ qua các file đã xử lý có hậu tố `-done` hoặc `- done`.
- **Phân tích (Parse) tên file theo cấu trúc:** `ID - SIZE - QTY - STT`  
  *(Ví dụ: `PET_001 - 5.5in - 3 - A01` hoặc `DINH HINH - 3.5in - 2 - B02`)*
  - `id`: Mã sản phẩm.
  - `size`: Kích thước tính bằng inch (hỗ trợ nhận diện chuỗi `"in"`, `"inch"`, dấu chấm/phẩy thập phân).
  - `qty`: Số lượng bản in cần nhân bản (mặc định là $1$).
  - `stt`: Số thứ tự hoặc ghi chú đính kèm.
  - `isSll`: Nhận diện từ khóa `"SLL"` trong tên file.
  - `isDinhHinh`: Kiểm tra từ khóa `"transparent"` trong tên file để phân biệt phôi **Định Hình** hay **Sticker thường**.
- **Tính toán khoảng đệm bù trừ viền (`gapPt`) theo loại phôi:**
  - **Phôi Định Hình (`isDinhHinh = true`):** Chỉ tạo nét Kiss, $\text{paddingMM} = 2.5\text{ mm}$, suy ra:
    $$\text{gapPt} = 2.5 \times 2.834645669$$
  - **Sticker thường (`isDinhHinh = false`):** Có thêm viền Die bao ngoài:
    - $\text{offsetMM} = 2.5\text{ mm}$ (đối với size từ $2\text{--}4\text{ in}$) hoặc bằng số $\text{inch}$ (đối với size từ $4\text{--}20\text{ in}$).
    - $\text{paddingMM} = \text{offsetMM} + 0.75\text{ mm}$ (đảm bảo khoảng cách giữa 2 viền Die liền kề là $1.5\text{ mm}$).
    - Công thức quy đổi sang point:
      $$\text{gapPt} = \text{paddingMM} \times 2.834645669$$
- Lấy kích thước đích `targetSizePt` thông qua bảng tra cứu `getCorrectedTargetPt(inch)` ($\text{inch} \times 72\text{ pt}$).
- **Xử lý ngoại lệ:** Nếu tên file sai định dạng không thể parse `size` hoặc `id`, ghi log và di chuyển thẳng file sang `IMAGE_ERROR_FOLDER`.

### 4. Sắp xếp thứ tự ưu tiên (Sort Jobs)
Danh sách `pendingJobs` được sắp xếp theo thứ tự ưu tiên giảm dần:
1. **Kích thước lớn xếp trước:** `targetSizePt` giảm dần.
2. **Số lượng lớn xếp trước:** Nếu cùng kích thước, ưu tiên `qty` giảm dần.
3. **Mã định danh:** Sắp xếp theo `id` (A-Z) để đảm bảo tính ổn định của hàng đợi.

### 5. Khởi tạo bộ xếp hình thông minh (Smart Packer - MaxRects Bin Packing)
- Quét layer `"kiss"` (nếu có) để xác định vùng diện tích khả dụng, hoặc lấy theo Bounding Box của Artboard hiện hành.
- Khởi tạo vùng trống ban đầu `freeRects` lùi vào một khoảng an toàn:
  $$\text{safeMargin} = \text{MARGIN\_MM} + 5\text{ mm}$$
- Nếu đang ở chế độ `WAIT_MODE` và có file JSON metadata, nạp mảng `usedRects` đã sử dụng trước đó và tái cấu trúc lại phần diện tích trống qua hàm `rebuildFreeRectsFromUsedRects()`.
- **Các phương thức chính của Smart Packer:**
  - `canFit(w, h)`: Kiểm tra kích thước có vừa vùng trống không.
  - `countFitInch(inch)`: Đếm số lượng phôi tối đa theo kích thước inch có thể nhồi thêm.
  - `place(item, itemGapPt)`: Đặt phôi vào vị trí tối ưu (hỗ trợ xoay $90^\circ$ nếu `ALLOW_ROTATE = true`).
  - `getUsedRects()` / `getPackedBounds()`: Truy xuất dữ liệu vùng đã xếp.

### 6. Vòng lặp xử lý chính (Main Processing Loop)
Duyệt tuần tự qua danh sách `pendingJobs`:
1. **Kiểm tra bộ lọc kích thước (`blockedSizeKeys`):** Bỏ qua ngay các kích thước đã được đánh dấu là không còn chỗ trống trên sheet hiện tại.
2. **Kiểm tra số lần lỗi (`jobFailureCount`):** Nếu một file thất bại $\ge 2$ lần liên tiếp, tự động cách ly sang `IMAGE_ERROR_FOLDER` và loại khỏi hàng đợi.
3. **Khởi tạo Artwork trên `masterLayer` qua hàm `createArtworkWithInvert`:**
   - Gọi `createArtworkCore(..., useInvert = true)`.
   - Nếu lượt chạy đầu gặp lỗi thực thi hoặc không vượt qua bước kiểm tra (validation): ghi log, xóa layer lỗi, tạo layer mới và tự động chuyển sang cơ chế dự phòng `createArtworkWithoutInvert(..., useInvert = false)`.
   - Nếu cả 2 lượt đều thất bại (trả về `null`): chuyển file sang `IMAGE_ERROR_FOLDER`.
4. **Nhân bản & Xếp lên bàn in:** Khi tạo `masterGroup` thành công, gọi `placeQuantityCopiesOneByOne()` để nhân bản theo số lượng `qty` và đưa vào `packer` xếp lên sheet.
5. **Cập nhật trạng thái sau khi xếp:**
   - **Nếu đặt thành công ít nhất $1$ bản:** Ghi nhận vào danh sách hoàn thành trên sheet hiện tại để chuẩn bị chuyển sang `image-done` (hoặc trừ lùi số lượng còn lại).
   - **Nếu không đặt vừa bản nào ($0$ copy):** Tăng `jobFailureCount`, đưa kích thước này vào `blockedSizeKeys` của sheet hiện tại. Nếu gặp phôi nhỏ ($\le 1.5\text{ in}$ hoặc $= 2.5\text{ in}$) mà vẫn không vừa, tiến hành lưu sheet ngay và mở template mới.
6. **Kết thúc bàn in:** Khi toàn bộ job trong hàng đợi đều không thể xếp thêm vào sheet hiện tại, tự động gọi `saveAndContinueOrStop()` để xuất file và mở bàn in mới.

### 7. Quy trình tạo Artwork (Pipeline 5 Bước Chuẩn Hóa)
Hàm `createLayerAndPlace()` tạo layer riêng, chèn ảnh qua `placedItems.add()`, đưa về tọa độ gốc $[0, 0]$ và chuyển tiếp vào `processPlacedImageOnActiveLayer()`:

- **B1. Embed + Chuẩn hóa Raster + Nhân đôi 2 lớp:**
  - Nhúng ảnh trực tiếp vào tài liệu (`img.embed()`).
  - Rasterize lại ở độ phân giải $72\text{ ppi}$ để chuẩn hóa ma trận pixel và cắt sát khung hình thực tế $\rightarrow$ thu được lớp gốc `fixedBottom` (nằm dưới, dùng làm hình ảnh hiển thị trong Clipping Mask ở bước cuối).
  - Nhân đôi `fixedBottom` $\rightarrow$ tạo thành `rasterTop` (nằm trên, dùng để xử lý lấy biên dạng đường cắt Kiss).

- **B2. Xử lý tương phản tạo khối trên `rasterTop`:**
  - Thực thi Action `ACTION_COLOR_BALANCE` (`"ColorBalanceKiss"`) với thông số $C = -100, M = -100, Y = -100, K = +100$ nhằm đẩy phần hình ảnh thành mảng tối rõ rệt so với nền.
  - *Fallback:* Nếu không tìm thấy Action, sử dụng lệnh hệ thống `executeMenuCommand("Colors6")` (Invert) theo cờ điều khiển.

- **B3. Image Trace (Low Fidelity Photo) + Expand:**
  - Gọi `rasterTop.trace()`, áp dụng preset **`"Low Fidelity Photo"`** để bám sát biên dạng chi tiết của phôi.
  - Thực thi `expandTracing()` để chuyển kết quả trace thành các đối tượng vector.

- **B4. Ungroup $\rightarrow$ Tìm & Xóa Path có Fit lớn nhất (Nền) $\rightarrow$ Gom nhóm:**
  - Gọi lệnh `executeMenuCommand("ungroup")` (hoặc rã các cấp Group con) để tách rời toàn bộ các `PathItem` / `CompoundPathItem` sau khi Expand.
  - **Chuẩn hóa lọc xóa nền:**
    - Duyệt qua tất cả các đối tượng Path vừa tách trong layer hiện hành.
    - Tính toán kích thước bao phủ (Fit / Bounding Box Area: $\text{Area} = \text{width} \times \text{height}$ hoặc chu vi bao ngoài lớn nhất từ `geometricBounds`).
    - Xác định và **xóa đối tượng Path có độ phủ (fit) lớn nhất** — đây chính là mảng khung nền bao quanh toàn bộ bức ảnh được sinh ra bởi chế độ trace *Low Fidelity Photo*.
    - *(Tùy chọn bổ sung)*: Kết hợp dọn dẹp các mảnh rác viền ngoài hoặc hợp nhất các mảng bên trong bằng Action `"Merge"` / `"Unite"`.
  - Gom toàn bộ các phần tử Path thuộc phôi còn lại thành nhóm biên dạng chuẩn `kissGroup`.

- **B5. Thiết lập nét cắt Đỏ CMYK + Căn giữa + Hoàn thiện Artwork:**
  - Áp dụng định dạng cho `kissGroup`: Stroke màu **CMYK Red** ($C=0, M=100, Y=100, K=0$), độ dày nét $0.25\text{ pt}$, Fill = `None`.
  - Căn giữa đồng tâm (Horizontal & Vertical Align Center) giữa `kissGroup` và lớp ảnh gốc `fixedBottom`.
  - Thực hiện chuỗi hoàn thiện: **Offset Path** ($-1\text{ pt}$, kiểu góc `Round`) $\rightarrow$ **Expand Style** $\rightarrow$ tạo **Compound Path** $\rightarrow$ đóng gói **Clipping Mask** với `fixedBottom` $\rightarrow$ **Scale** về đúng kích thước `targetSizePt` $\rightarrow$ kiểm tra hợp lệ (Validation) $\rightarrow$ đóng gói thành `masterGroup` hoàn chỉnh.

### 8. Phân tách đường bế sang Layer `kiss` và `die` (`moveCutPathsToTargetLayers`)
Sau khi một bản sao artwork được `packer.place()` đặt vào vị trí hợp lệ trên bàn in, script tiến hành rã nhóm tạm (`ungroupTempFinalGroup`) và phân luồng đường cắt:
- **Trường hợp Phôi Định Hình (`isDinhHinh = true`):**
  - Thu thập đường nét cắt gốc (màu đỏ CMYK) và di chuyển trực tiếp vào layer **`kiss`**. Không tạo nét Die.
- **Trường hợp Sticker thường (`isDinhHinh = false`):**
  1. Giữ nguyên đường cắt gốc (màu đỏ CMYK, $0.25\text{ pt}$) và chuyển vào layer **`kiss`**.
  2. Nhân bản đường cắt gốc, áp dụng hiệu ứng `Adobe Offset Path` phình rộng ra ngoài một khoảng bằng `offsetMM` ($2.5\text{ mm}$ hoặc theo số inch của phôi).
  3. Thực thi lệnh `expandStyle`, hợp nhất biên dạng và đổi màu Stroke sang **CMYK Green** ($C=85, M=10, Y=100, K=0$), độ dày $0.25\text{ pt}$, Fill = `None`.
  4. Di chuyển đường viền xanh lá này vào layer **`die`**.

### 9. Lưu Bàn In & Quản lý Metadata (`saveCurrentSheetAs`)
- Bỏ chọn tất cả đối tượng (`doc.selection = null`), điều chỉnh trạng thái ẩn/hiện của layer `kiss` và `die` theo quy chuẩn trước khi xuất sang `OUTPUT_FOLDER`.
- Lưu file `.ai` với tên định danh theo mốc thời gian (Timestamp) hoặc hậu tố `_wait_<maxInch>.ai` nếu bàn in chưa đầy và cần chờ ghép thêm.
- Xuất file ghi chú `.txt` vào thư mục `note_done`, liệt kê danh sách mã `ID` và số lượng các sản phẩm đã được xếp trên bàn in đó.
- Nếu lưu ở chế độ **Wait**, xuất kèm file `.json` vào `WAIT_META_FOLDER` lưu toàn bộ mảng tọa độ `usedRects`.
- Cập nhật trạng thái các file ảnh nguồn đã xử lý trong `currentSheetDoneFiles`.
- Đóng tài liệu hiện tại (`SaveOptions.DONOTSAVECHANGES`) để giải phóng bộ nhớ và sẵn sàng mở template mới.

### 10. Quản lý Trạng thái File Ảnh Nguồn (File Management)
- **Đã xếp đủ 100% số lượng (`doneQty == qty`):** Di chuyển file ảnh gốc sang `IMAGE_DONE_FOLDER` và gắn thêm hậu tố `- done`.
- **Mới xếp được một phần (`doneQty < qty`):**
  - Tạo bản sao lưu phần đã chạy xong vào `IMAGE_DONE_FOLDER` kèm số lượng đã in.
  - Đổi tên file ảnh gốc tại thư mục đầu vào với số lượng mới bằng phần còn dư ($\text{remainQty} = \text{qty} - \text{doneQty}$) để bàn in tiếp theo tự động chạy tiếp.
- **File bị lỗi (Lỗi cú pháp tên file hoặc thất bại sau cả 2 lượt thử tạo Artwork):** Di chuyển thẳng sang `IMAGE_ERROR_FOLDER` để kiểm tra thủ công.

### 11. Chế độ Gỡ lỗi & Vận hành An toàn (Debug & Safety)
- **Chế độ từng bước (`DEBUG_STEP_MODE`):** Khi bật `true`, script sẽ hiển thị hộp thoại xác nhận (`confirm`) sau từng công đoạn (Embed, Color Balance/Invert, Trace Low Fidelity, Xóa Path có fit lớn nhất, Offset, Clipping Mask, Resize) để kỹ thuật viên quan sát trực quan.
- **Giám sát tiến trình (`writeWorkNote`):** Liên tục cập nhật file `working.txt` giúp các tiến trình bên ngoài (như n8n hoặc Watchdog script) biết Illustrator vẫn đang hoạt động bình thường.
- **Cơ chế chống treo (`try-catch-finally`):** Mọi thao tác can thiệp DOM phức tạp đều được bọc bảo vệ, đảm bảo khôi phục `app.userInteractionLevel` kể cả khi xảy ra lỗi ngoại lệ.

---

## 12. TÓM TẮT DANH SÁCH HÀM CHÍNH

| Tên hàm | Nhiệm vụ chính |
| :--- | :--- |
| `parseFileName` | Tách thông tin `ID`, `SIZE`, `QTY`, `STT`, nhận diện phôi định hình/sticker và tính khoảng bù `gapPt`. |
| `createArtworkWithInvert` / `WithoutInvert` | Điều phối quá trình tạo artwork với cơ chế tự động thử lại (Fallback) khi gặp lỗi. |
| `createArtworkCore` | Khởi tạo layer nháp, đặt file ảnh vào gốc tọa độ và gọi pipeline xử lý vector. |
| `processPlacedImageOnActiveLayer` | **Pipeline 5 bước:** Embed & Nhân đôi $\rightarrow$ Chỉnh tương phản $\rightarrow$ Trace *Low Fidelity Photo* $\rightarrow$ Ungroup & **Xóa Path có fit lớn nhất** $\rightarrow$ Tạo nét Kiss, Offset, Mask & Scale. |
| `removeLargestFitPath` *(Helper)* | Duyệt các Path sau khi Ungroup kết quả trace, đo diện tích Bounding Box ($\text{width} \times \text{height}$) và xóa phần tử lớn nhất (nền ảnh). |
| `moveCutPathsToTargetLayers` | Phân tách đường cắt đỏ vào layer `kiss` và tự động nhân bản/offset đường cắt xanh lá vào layer `die`. |
| `createSmartPacker` | Thuật toán đóng gói 2D MaxRects, hỗ trợ xoay phôi $90^\circ$ và đọc/ghi dữ liệu `usedRects`. |
| `placeQuantityCopiesOneByOne` | Nhân bản artwork theo `qty` và gọi bộ packer đặt từng bản lên artboard. |
| `saveCurrentSheetAs` | Xuất file `.ai`, ghi log `.txt` vào `note_done`, lưu `.json` vào `wait-meta` và đóng file an toàn. |
| `moveFileToDoneFolder` / `ErrorFolder` | Quản lý di chuyển, đổi tên trừ lùi số lượng hoặc cách ly file ảnh nguồn bị lỗi. |

---

## KNOWN LIMITATIONS (LƯU Ý VẬN HÀNH)
1. **Hiệu năng lệnh hệ thống:** Các lệnh `trace()`, `expandTracing()` và `executeMenuCommand()` khi xử lý ảnh raster có kích thước hoặc độ phân giải quá lớn có thể tiêu tốn nhiều RAM; việc chuẩn hóa Rasterize về $72\text{ ppi}$ ở Bước 7-B1 giúp giảm thiểu tối đa rủi ro này.
2. **Yêu cầu cấu hình Illustrator:** Máy chạy script cần đảm bảo có sẵn preset Image Trace **`"Low Fidelity Photo"`** và bộ Action Set **`"My set"`** (bao gồm các Action `"ColorBalanceKiss"`, `"Merge"`, `"Unite"`).

## KẾT LUẬN
- Quy trình đã được chuẩn hóa sang hướng sử dụng **Low Fidelity Photo** kết hợp thuật toán **xóa Path có kích thước bao phủ (fit) lớn nhất**, giúp loại bỏ triệt để phần nền bao ngoài mà không phụ thuộc hoàn toàn vào mã màu trắng tinh khiết của nền ảnh.
- Cơ chế phân tách tự động layer `kiss` (đỏ CMYK) và `die` (xanh lá CMYK) cùng khả năng lưu ghép bàn chờ (`Wait Mode`) giúp tối ưu hóa diện tích vật liệu in và sẵn sàng đưa thẳng vào máy cắt bế sản xuất.