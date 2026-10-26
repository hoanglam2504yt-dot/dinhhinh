/*
DETAILED LOGIC - BATCH IMPORT LAYERS (CHUẨN HÓA TRANSPARENT)

MỤC ĐÍCH & PHẠM VI
- Script tự động hóa quy trình chuyển ảnh phôi Transparent (raster) thành artwork vector
  trong Adobe Illustrator, sau đó xếp các artwork này lên artboard theo thuật toán
  bin-packing (smart packer). Script thực hiện tracing, xử lý path, tạo đường bế kiss-cut,
  tô màu chuẩn CMYK và quản lý file (image-done / image-error / wait / note_done).
*/

#target illustrator

function showAlert(msg) {
    try {
        var f = new File("X:/OUTPUT/MUTOL/TRANSPARENT/debug_alert.txt");
        f.open("a");
        f.writeln(new Date().getTime() + " : " + msg);
        f.close();
    } catch (e) { }
}

(function () {
    // =========================================================================
    // 1) THIẾT LẬP ĐƯỜNG DẪN HỆ THỐNG & THƯ MỤC LÀM VIỆC
    // =========================================================================
    var OUT_TEMPLATE = "X:/OUTPUT/MUTOL/TRANSPARENT/template";               // Thư mục chứa template gốc (template_saved.ai)
    var IMAGE_FOLDER = "X:/INPUT/TRANSPARENT";                                  // Thư mục chứa file ảnh phôi Transparent cần xử lý
    var IMAGE_DONE_FOLDER = "X:/OUTPUT/MUTOL/TRANSPARENT/images_done";       // Thư mục lưu trữ ảnh đã hoàn thành xếp phôi
    var IMAGE_ERROR_FOLDER = "X:/OUTPUT/MUTOL/TRANSPARENT/images_error";     // Thư mục cách ly file ảnh bị lỗi (lỗi parse, lỗi vectorizing)
    var OUTPUT_FOLDER = "X:/OUTPUT/MUTOL/TRANSPARENT/output_ai";             // Thư mục xuất file kết quả Illustrator (.ai)
    var NOTE_DONE_FOLDER = "X:/OUTPUT/MUTOL/TRANSPARENT/note_done";          // Thư mục lưu file .txt ghi nhận ID các mẫu có trên sheet
    var WAIT_FOLDER = "X:/OUTPUT/MUTOL/TRANSPARENT/wait";                    // Thư mục lưu file dở dang ở chế độ chờ (Wait Mode)
    var WAIT_META_FOLDER = "X:/OUTPUT/MUTOL/TRANSPARENT/wait-meta";          // Thư mục lưu file JSON metadata chứa tọa độ usedRects cũ
    var NOTEWORKFOLDER = "X:/OUTPUT/MUTOL/TRANSPARENT/note_work";            // Thư mục chứa file working.txt phục vụ theo dõi real-time
    var PNG_FOLDER = "X:/OUTPUT/MUTOL/TRANSPARENT/png_decal_dtf";            // Thư mục xuất file PNG tách nền DTF

    // =========================================================================
    // THIẾT LẬP THAM SỐ VẬN HÀNH & KÍCH THƯỚC ĐỆM (PADDING / GAP)
    // =========================================================================
    var GAP_MM = 5;                                   // Khoảng cách an toàn mặc định giữa các artwork (mm)
    var MARGIN_MM = 3;                                // Lề an toàn viền Artboard/khổ in (mm)
    var RUN_WAIT_MODE = false;                        // Cờ bật chế độ Wait (tự động phát hiện khi có file _wait_)
    var WAIT_SOURCE_FILE = null;                      // File wait nguồn đang mở
    var WAIT_BASE_NAME = "";                          // Tên cơ sở của file wait
    var WAIT_MAX_INCH = null;                         // Kích thước inch tối đa cho phép xếp tiếp vào wait file hiện tại
    var SHOULD_CLOSE_AFTER_SAVE = false;              // Cờ xác định có đóng document sau khi save hay không
    var GAP_PT = GAP_MM * 2.834645669;                // Quy đổi khoảng cách mm sang Points (1mm = 2.834645669 pt)
    var MARGIN_PT = MARGIN_MM * 2.834645669;          // Quy đổi lề mm sang Points
    var ALLOW_ROTATE = true;                          // Cho phép xoay phôi 90 độ để tối ưu diện tích xếp
    var ACTION_SET = "Myset";                         // Tên Action Set trong Illustrator
    var ACTION_SET_FALLBACK = "My set";               // Tên Action Set dự phòng
    var ACTION_MERGE = "Merge";                       // Tên Action Pathfinder Merge
    var ACTION_UNITE = "Unite";                       // Tên Action Pathfinder Unite
    var ACTION_COLOR_BALANCE = "ColorBalanceKiss";    // Action điều chỉnh màu sắc: C:-100 M:-100 Y:-100 K:+100
    var AUTO_LAYER_PREFIX = "__AUTO_BATCH__ ";        // Tiền tố đặt tên layer tự động cho các đối tượng
    var PREVIEW_LAYER_NAME = "__WAIT_FIT_PREVIEW__";  // Tên layer xem trước vị trí fit
    var FAST_MODE = true;                             // Chế độ chạy nhanh (giảm thời gian $.sleep giữa các bước)
    var SLEEP_SCALE = 0.35;                           // Tỷ lệ thu nhỏ thời gian chờ ở chế độ FAST_MODE
    var MIN_SLEEP = 80;                               // Thời gian chờ tối thiểu (ms)
    var SHOW_WAIT_FIT_PREVIEW = false;                // Cờ bật xem trước vị trí fit
    var OLD_USER_INTERACTION_LEVEL = app.userInteractionLevel; // Lưu cài đặt cảnh báo của người dùng
    var CURRENTWORKFILE = null;                       // Con trỏ tới file working.txt hiện tại
    var MAX_IMAGES_BEFORE_WAIT = 50;                  // Số lượng ảnh tối đa xử lý trước khi kích hoạt wait
    var DEBUG_STEP_MODE = false;                      // Đặt true để bật chế độ confirm debug dừng từng bước

    function runActionSafe(actionName, primarySet) {
        var setToTry = primarySet || ACTION_SET;
        try {
            app.doScript(actionName, setToTry);
            return true;
        } catch (e1) {
            var altSet = (setToTry === "Myset") ? ACTION_SET_FALLBACK : "Myset";
            try {
                app.doScript(actionName, altSet);
                return true;
            } catch (e2) {
                throw e1;
            }
        }
    }

    function writeWorkNote(jobName, workIds) {
        try {
            if (typeof noteWorkFolder === "undefined") return;
            if (!CURRENTWORKFILE) {
                var n = new Date().getTime();
                CURRENTWORKFILE = new File(noteWorkFolder.fsName + "/working_" + n + ".txt");
            }
            CURRENTWORKFILE.open("w");
            CURRENTWORKFILE.writeln("JOB: " + jobName);
            if (workIds && workIds.length) {
                CURRENTWORKFILE.writeln("IDS: " + workIds.join(", "));
            }
            CURRENTWORKFILE.close();
        } catch (e) { }
    }

    function removeWorkNote() {
        try {
            if (CURRENTWORKFILE && CURRENTWORKFILE.exists) {
                CURRENTWORKFILE.remove();
            }
        } catch (e) { }
    }

    function getFirstWaitFile(waitFolder) {
        if (!waitFolder || !waitFolder.exists) return null;

        var waitFiles = waitFolder.getFiles(function (f) {
            return f instanceof File && /\.ai$/i.test(f.name) && /_wait_/i.test(f.name);
        });

        if (!waitFiles || waitFiles.length === 0) return null;

        waitFiles.sort(function (a, b) {
            if (a.modified > b.modified) return -1;
            if (a.modified < b.modified) return 1;
            return String(a.name).localeCompare(String(b.name));
        });

        var f = waitFiles[0];
        var base = stripExt(f.name);

        var m = base.match(/^(.*)_wait_([0-9]+(?:_[0-9]+)?)$/i);
        if (!m) return null;

        var baseName = m[1];
        var inchText = m[2].replace("_", ".");
        var maxInch = parseFloat(inchText);

        return {
            file: f,
            baseName: baseName,
            maxInch: maxInch
        };
    }

    try {
        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;

        var outFolder = new Folder(OUTPUT_FOLDER);
        if (!outFolder.exists) outFolder.create();

        var noteDoneFolder = new Folder(NOTE_DONE_FOLDER);
        if (!noteDoneFolder.exists) noteDoneFolder.create();

        var waitFolder = new Folder(WAIT_FOLDER);
        if (!waitFolder.exists) waitFolder.create();

        var waitMetaFolder = new Folder(WAIT_META_FOLDER);
        if (!waitMetaFolder.exists) waitMetaFolder.create();

        var doneFolder = new Folder(IMAGE_DONE_FOLDER);
        if (!doneFolder.exists) doneFolder.create();

        var errorFolder = new Folder(IMAGE_ERROR_FOLDER);
        if (!errorFolder.exists) errorFolder.create();

        var noteWorkFolder = new Folder(NOTEWORKFOLDER);
        if (!noteWorkFolder.exists) noteWorkFolder.create();

        var waitJob = getFirstWaitFile(waitFolder);
        var doc = null;

        if (waitJob) {
            RUN_WAIT_MODE = true;
            WAIT_SOURCE_FILE = waitJob.file;
            WAIT_BASE_NAME = waitJob.baseName;
            WAIT_MAX_INCH = waitJob.maxInch;

            doc = app.open(WAIT_SOURCE_FILE);
        } else {
            var tmplFileOpen = new File(OUT_TEMPLATE + "/template_saved.ai");
            if (tmplFileOpen.exists) {
                doc = app.open(tmplFileOpen);
            }
        }

        var currentJobName = RUN_WAIT_MODE && WAIT_SOURCE_FILE
            ? WAIT_SOURCE_FILE.name
            : "template_saved.ai";

        writeWorkNote(currentJobName);

        if (app.documents.length === 0) {
            throw new Error("Bạn cần mở sẵn file Illustrator/template trước khi chạy script.");
        }

        doc = app.activeDocument;

        var folder = new Folder(IMAGE_FOLDER);
        if (!folder.exists) {
            throw new Error("Không tìm thấy folder: " + IMAGE_FOLDER);
        }

        var files = folder.getFiles(function (f) {
            if (!(f instanceof File)) return false;
            var cleanBase = stripExt(cleanFileName(f.name));
            if (/-\s*done\s*$/i.test(cleanBase)) return false;
            return /\.(jpg|jpeg|png|tif|tiff|bmp|psd|ai)$/i.test(cleanFileName(f.name));
        });

        var processedFileCount = 0;
        var placedCopyCount = 0;
        var stoppedByUser = false;

        if (!files || files.length === 0) {
            removeWorkNote();

            if (RUN_WAIT_MODE) {
                $.writeln("Wait mode: không có file transparent <= " + WAIT_MAX_INCH + "in. Giữ wait file và dừng.");
                showAlert(
                    "Không có ảnh phù hợp <= " + WAIT_MAX_INCH + "in trong folder " + IMAGE_FOLDER + ".\n" +
                    "Wait file được giữ để chạy lại sau.\n" +
                    "Đã xử lý " + processedFileCount + " ảnh gốc, tạo " + placedCopyCount + " artwork."
                );
                return;
            }

            showAlert("Không có ảnh cần xử lý trong folder " + IMAGE_FOLDER);
            return;
        }

        var packer = createSmartPacker(
            doc,
            MARGIN_PT,
            GAP_PT,
            ALLOW_ROTATE,
            RUN_WAIT_MODE ? WAIT_BASE_NAME : null,
            RUN_WAIT_MODE ? WAIT_MAX_INCH : null,
            waitMetaFolder
        );

        var currentSheetIds = [];
        var currentSheetLayers = [];
        var currentSheetDoneFiles = [];

        var placedCountByFile = {};
        var failedFileKeys = {};
        var placedOnSheetCount = 0;

        // ==========================================
        // 3) ĐỌC & TẠO JOBS (CHUẨN HÓA TRANSPARENT)
        // ==========================================
        var jobs = [];

        for (var f = 0; f < files.length; f++) {
            try {
                var info = parseFileName(files[f].name);

                if (RUN_WAIT_MODE && info.inch > WAIT_MAX_INCH) {
                    continue;
                }

                jobs.push({
                    file: files[f],
                    info: info
                });
            } catch (errParse) {
                var parseErrMsg = getErrorMessage(errParse);
                $.writeln("File lỗi tên/size: " + files[f].fsName + " | " + parseErrMsg);
                showAlert("Lỗi khi đọc file: " + files[f].name + "\nChi tiết: " + parseErrMsg);
                moveFileToErrorFolder(files[f], errorFolder, "Lỗi đọc tên file: " + parseErrMsg);
            }
        }

        var workIds = [];
        var seenWorkIds = {};
        for (var wi = 0; wi < jobs.length; wi++) {
            var wid = String(jobs[wi].info.id);
            if (!seenWorkIds[wid]) {
                seenWorkIds[wid] = true;
                workIds.push(wid);
            }
        }
        writeWorkNote(currentJobName, workIds);

        // ==========================================
        // 4) SẮP XẾP JOBS: LỚN -> NHỎ, QTY LỚN -> NHỎ, ID
        // ==========================================
        jobs.sort(function (a, b) {
            if (a.info.targetSizePt !== b.info.targetSizePt) {
                return b.info.targetSizePt - a.info.targetSizePt;
            }
            if (a.info.qty !== b.info.qty) {
                return b.info.qty - a.info.qty;
            }
            return String(a.info.id).localeCompare(String(b.info.id));
        });

        var pendingJobs = jobs.slice();
        var jobFailureCount = {};
        var jobFailureReason = {};
        var blockedSizeKeys = {};
        var skippedOnCurrentSheet = {}; // Đánh dấu từng file không fit sheet hiện tại (theo jobKey)

        function saveAndContinueOrStop() {
            if (currentSheetIds.length > 0) {
                saveCurrentSheetAs(doc, outFolder, currentSheetIds, waitMetaFolder, doneFolder);
                if (pendingJobs.length > 0) {
                    var tmplFileOpen = new File(OUT_TEMPLATE + "/template_saved.ai");
                    if (tmplFileOpen.exists) {
                        doc = app.open(tmplFileOpen);
                        packer = createSmartPacker(doc, MARGIN_PT, GAP_PT, ALLOW_ROTATE, null, null, waitMetaFolder);
                        currentSheetIds = [];
                        currentSheetLayers = [];
                        currentSheetDoneFiles = [];
                        placedOnSheetCount = 0;
                        blockedSizeKeys = {};
                        skippedOnCurrentSheet = {}; // Reset khi mở sheet mới
                        $.writeln("Opened new template for remaining jobs: " + pendingJobs.length);
                        return true;
                    } else {
                        showAlert("Không tìm thấy template_saved.ai để tiếp tục!");
                        stoppedByUser = true;
                        return false;
                    }
                } else {
                    stoppedByUser = true;
                    return false;
                }
            } else {
                var bSize = packer && typeof packer.getBinSize === "function" ? packer.getBinSize() : { w: 0, h: 0 };
                var wInch = (bSize.w / 72).toFixed(2);
                var hInch = (bSize.h / 72).toFixed(2);
                var msg = "Không có artwork nào fit vào sheet.\n\n" +
                    "KÍCH THƯỚC VÙNG IN TRÊN TEMPLATE:\n" +
                    "- Rộng (Width): " + wInch + " in\n" +
                    "- Cao (Height): " + hInch + " in\n\n" +
                    "CÁC LÝ DO CÓ THỂ:\n" +
                    "1. File transparent quá lớn vượt quá vùng in ở trên.\n" +
                    "2. Vùng in (Artboard hoặc khung 'kiss') trong file template_saved.ai đang bị thiết lập quá nhỏ.\n\n" +
                    "File vẫn được giữ trong thư mục ban đầu.";
                $.writeln(msg);
                showAlert(msg);
                stoppedByUser = true;
                return false;
            }
        }

        // ==========================================
        // 6) VÒNG LẶP XỬ LÝ JOB (MAIN LOOP)
        // ==========================================
        while (pendingJobs.length > 0 && !stoppedByUser) {
            var placedSomethingThisRound = false;

            for (var j = 0; j < pendingJobs.length; j++) {
                var file = pendingJobs[j].file;
                var info = pendingJobs[j].info;
                var jobKey = getFileKey(file);
                var sizeKey = toSizeKey(info.inch);

                // Nếu file này đã biết chắc không fit sheet hiện tại thì bỏ qua
                if (skippedOnCurrentSheet[jobKey]) {
                    continue;
                }

                if (!jobFailureCount[jobKey]) jobFailureCount[jobKey] = 0;
                if (jobFailureCount[jobKey] >= 2) {
                    var failReason = jobFailureReason[jobKey] || "File bị lỗi lặp lại 2+ lần liên tiếp, không xử lý được";
                    $.writeln("File bị stuck (fail 2+ lần): " + file.fsName);
                    moveFileToErrorFolder(file, errorFolder, failReason);
                    pendingJobs.splice(j, 1);
                    delete jobFailureCount[jobKey];
                    delete jobFailureReason[jobKey];
                    delete skippedOnCurrentSheet[jobKey];
                    j--;
                    continue;
                }

                try {
                    var masterLayerName = makeUniqueLayerName(
                        doc,
                        AUTO_LAYER_PREFIX + info.id + " - " + info.sizeText + " - master - STT " + info.stt
                    );

                    var masterGroup = createArtworkWithInvert(
                        doc,
                        file,
                        masterLayerName,
                        info.targetSizePt,
                        info.inch,
                        ACTION_SET,
                        ACTION_MERGE,
                        ACTION_UNITE,
                        info
                    );

                    if (masterGroup === null) {
                        moveFileToErrorFolder(
                            file,
                            errorFolder,
                            "createArtworkWithInvert trả về null: không tạo được artwork từ file ảnh (file hỏng, action lỗi, hoặc không có vùng cắt hợp lệ)"
                        );
                        pendingJobs.splice(j, 1);
                        delete jobFailureCount[jobKey];
                        delete jobFailureReason[jobKey];
                        delete skippedOnCurrentSheet[jobKey];
                        j--;
                        continue;
                    }

                    try {
                        masterGroup.layer.visible = false;
                    } catch (e) { }

                    var ok = placeQuantityCopiesOneByOne(doc, masterGroup, file, info);

                    try {
                        masterGroup.layer.locked = false;
                        masterGroup.layer.visible = true;
                        masterGroup.layer.remove();
                    } catch (e) { }

                    if (ok) {
                        pendingJobs.splice(j, 1);
                        delete jobFailureCount[jobKey];
                        delete jobFailureReason[jobKey];
                        delete skippedOnCurrentSheet[jobKey];
                        j--;
                        placedSomethingThisRound = true;
                        continue;
                    }

                    // Artwork đã trace xong nhưng không fit sheet này
                    // → Đánh dấu riêng file này, KHÔNG block cả kích thước
                    // → Các ảnh cùng size khác vẫn tiếp tục được trace và thử place
                    skippedOnCurrentSheet[jobKey] = true;
                    $.writeln("File không fit sheet hiện tại (skip file này, tiếp tục ảnh khác): " + info.sizeText + " | " + file.name);
                    continue;

                } catch (errJob) {
                    var jobErrMsg = getErrorMessage(errJob);
                    $.writeln("File lỗi: " + file.fsName + " | " + jobErrMsg);
                    jobFailureCount[jobKey]++;
                    jobFailureReason[jobKey] = jobErrMsg;
                    continue;
                }
            }

            jobFailureCount = {};

            if (!placedSomethingThisRound) {
                saveAndContinueOrStop();
            }
        }

        function placeQuantityCopiesOneByOne(doc, sourceGroup, file, info) {
            var quantity = info && info.qty ? info.qty : 1;
            var placedThisFile = 0;

            for (var copyIndex = 1; copyIndex <= quantity; copyIndex++) {
                var copyLayerName = makeUniqueLayerName(
                    doc,
                    AUTO_LAYER_PREFIX + info.id + " - " + info.sizeText + " - qty " + copyIndex + " of " + info.qty + " - STT " + info.stt
                );

                var copyLayer = doc.layers.add();
                copyLayer.name = copyLayerName;

                var copiedGroup = sourceGroup.duplicate(copyLayer, ElementPlacement.PLACEATBEGINNING);

                try {
                    copyLayer.visible = true;
                } catch (e) { }

                var artwork = {
                    group: copiedGroup,
                    layer: copyLayer,
                    info: info,
                    file: file,
                    copyIndex: copyIndex
                };

                var ok = placeArtworkNow(artwork);

                if (!ok) {
                    try {
                        copyLayer.locked = false;
                        copyLayer.visible = true;
                        copyLayer.remove();
                    } catch (e) { }

                    break;
                }

                placedThisFile++;
            }

            if (placedThisFile > 0) {
                var remainQty = quantity - placedThisFile;
                queueDoneFileForCurrentSheet(file, info, placedThisFile, remainQty);
                return true;
            }

            return false;
        }

        function placeArtworkNow(artwork) {
            var finalGroup = artwork.group;

            while (true) {
                try {
                    artwork.layer.visible = true;
                } catch (showErr) { }

                if (packer.place(finalGroup, artwork.info.gapPt)) {
                    break;
                }

                try {
                    artwork.layer.visible = false;
                    artwork.layer.locked = false;
                    artwork.layer.remove();
                } catch (e) { }

                return false;
            }

            ungroupTempFinalGroup(doc, finalGroup);

            try {
                moveCutPathsToTargetLayers(doc, artwork.layer, artwork.info);
            } catch (moveErr) { }

            pushUniqueCurrentSheetId(artwork.info.id);
            currentSheetLayers.push(artwork.layer);
            placedCopyCount++;
            placedOnSheetCount++;
            return true;
        }

        if (currentSheetIds.length > 0) {
            saveCurrentSheetAs(doc, outFolder, currentSheetIds, waitMetaFolder, doneFolder);

            if (SHOULD_CLOSE_AFTER_SAVE) {
                try {
                    app.userInteractionLevel = OLD_USER_INTERACTION_LEVEL;
                } catch (e) { }

                try {
                    doc.close(SaveOptions.DONOTSAVECHANGES);
                } catch (e) { }

                try {
                    app.quit();
                } catch (e) { }

                return;
            }
        }

        doc.selection = null;
        app.userInteractionLevel = OLD_USER_INTERACTION_LEVEL;

        showAlert(
            (stoppedByUser ? "Đã dừng theo yêu cầu.\n" : "Xong.\n") +
            "Đã xử lý " + processedFileCount + " ảnh gốc, tạo " + placedCopyCount + " artwork.\n" +
            "File AI đã save trong: " + OUTPUT_FOLDER
        );

    } catch (e) {
        removeWorkNote();
        try { app.userInteractionLevel = OLD_USER_INTERACTION_LEVEL; } catch (restoreErr) { }
        showAlert("Error: " + getErrorMessage(e));
    }

    // =========================================================================
    // 7) TẠO ARTWORK (PIPELINE 5 BƯỚC CHUẨN HÓA CHO TRANSPARENT)
    // =========================================================================

    function createArtworkCore(doc, file, layerName, targetSize, inch, actionSet, actionMerge, actionUnite, useInvert, info) {
        var created = null;

        try {
            created = createLayerAndPlace(doc, file, layerName);

            return processPlacedImageOnActiveLayer(
                doc,
                file,
                created.layer,
                created.placed,
                targetSize,
                inch,
                actionSet,
                actionMerge,
                actionUnite,
                useInvert,
                info
            );
        } catch (err) {
            try {
                if (created && created.layer) created.layer.remove();
            } catch (cleanupErr) { }

            throw err;
        }
    }

    function createArtworkWithoutInvert(doc, file, layerName, targetSize, inch, actionSet, actionMerge, actionUnite, info) {
        try {
            return createArtworkCore(
                doc,
                file,
                layerName,
                targetSize,
                inch,
                actionSet,
                actionMerge,
                actionUnite,
                false,
                info
            );
        } catch (err) {
            try {
                $.writeln("No-invert run failed for file: " + file.fsName + " | " + getErrorMessage(err));
            } catch (logErr) { }

            return null;
        }
    }

    function createArtworkWithInvert(doc, file, layerName, targetSize, inch, actionSet, actionMerge, actionUnite, info) {
        try {
            return createArtworkCore(
                doc,
                file,
                layerName,
                targetSize,
                inch,
                actionSet,
                actionMerge,
                actionUnite,
                true,
                info
            );
        } catch (err) {
            try {
                $.writeln("Retry without invert for file: " + file.fsName + " | " + getErrorMessage(err));
            } catch (logErr) { }

            var retryLayerName = makeUniqueLayerName(doc, layerName + " - retry no invert");
            return createArtworkWithoutInvert(
                doc,
                file,
                retryLayerName,
                targetSize,
                inch,
                actionSet,
                actionMerge,
                actionUnite,
                info
            );
        }
    }

    function createLayerAndPlace(doc, file, layerName) {
        var layer = doc.layers.add();
        layer.name = makeUniqueLayerName(doc, layerName);
        doc.activeLayer = layer;

        var placed = doc.placedItems.add();
        placed.file = file;
        placed.position = [0, 0];

        doc.selection = null;
        placed.selected = true;
        safeRedraw();
        fastSleep(400);

        return {
            layer: layer,
            placed: placed
        };
    }

    function safeRedraw(force) {
        if (force || !FAST_MODE || (typeof DEBUG_STEP_MODE !== "undefined" && DEBUG_STEP_MODE)) {
            try {
                app.redraw();
            } catch (e) { }
        }
    }

    function fastSleep(ms) {
        var t = FAST_MODE ? Math.max(MIN_SLEEP, Math.round(ms * SLEEP_SCALE)) : ms;
        $.sleep(t);
    }

    /**
     * processPlacedImageOnActiveLayer
     * Pipeline 5 bước chuẩn hóa để tạo ra kết quả giống 100% làm tay:
     * B1. Embed + Rasterize fixedBottom (300ppi) + Rasterize rasterTop (72ppi với lề đệm 15pt
     *     để hình không bao giờ chạm vào 4 cạnh khung ảnh khi Trace).
     * B2. Chạy Action ColorBalanceKiss (C:-100, M:-100, Y:-100, K:+100) trên rasterTop.
     * B3. Image Trace preset "Low Fidelity Photo" -> Expand Tracing.
     * B4. Ungroup toàn bộ -> Tìm và xóa đối tượng Path có fit (width * height) lớn nhất
     *     (chính là khung chữ nhật nền bao ngoài) + dọn các mảnh nền trắng lấp trong lỗ thủng
     *     (mắt, mũi, miệng) -> Group các path của hình lại thành kissGroup.
     * B5. Tô màu Đỏ CMYK (0.25pt, fill = None) -> Auto-crop fixedBottom -> Compound Path
     *     -> Tạo Clipping Mask -> Scale chuẩn 2 lượt -> Validation.
     */
    function processPlacedImageOnActiveLayer(doc, file, targetLayer, img, targetSize, inch, actionSet, actionMerge, actionUnite, useInvert, info) {
        doc.selection = null;
        img.selected = true;

        // =========================================================================
        // B1a: EMBED ẢNH NGUỒN
        // =========================================================================
        logProcessStep("embed", file, useInvert);
        img.embed();
        safeRedraw();
        fastSleep(500);

        assertSelection("embed", doc, 1);

        var embeddedRaster = doc.selection[0];

        // =========================================================================
        // B1b: TẠO fixedBottom (300 PPI CHO CHẤT LƯỢNG IN ẤN)
        // =========================================================================
        var originalForTrace = embeddedRaster.duplicate();

        var rOpts = new RasterizeOptions();
        rOpts.resolution = 300;
        rOpts.transparency = true;
        rOpts.antiAliasingMethod = AntiAliasingMethod.ARTOPTIMIZED;

        doc.selection = null;
        embeddedRaster.selected = true;

        var fixedBottom = doc.rasterize(embeddedRaster, embeddedRaster.geometricBounds, rOpts);
        doc.selection = null;
        fixedBottom.selected = true;
        fastSleep(400);

        // =========================================================================
        // B1c: TẠO rasterTop (72 PPI + ĐỆM LỀ 15PT ĐỂ KHÔNG DÍNH KHUNG CHỮ NHẬT NGOÀI)
        // Việc mở rộng traceBounds thêm 15pt mỗi phía giúp:
        // 1. Hình ảnh (như đáy móng chân, 2 đầu thanh ngang) không bị chạm mép biên ảnh.
        // 2. Vùng nền bên ngoài nối liền thông suốt thành đúng 1 Path khung bao duy nhất
        //    có diện tích fit (w * h) lớn nhất, giúp bước B4 xóa sạch 100% khung chữ nhật ngoài.
        // =========================================================================
        var rOptsTrace = new RasterizeOptions();
        rOptsTrace.resolution = 72;
        rOptsTrace.transparency = true;
        rOptsTrace.antiAliasingMethod = AntiAliasingMethod.ARTOPTIMIZED;

        doc.selection = null;
        originalForTrace.selected = true;

        var origB = originalForTrace.geometricBounds; // [left, top, right, bottom]
        var tracePad = 15;
        var paddedTraceBounds = [
            origB[0] - tracePad,
            origB[1] + tracePad,
            origB[2] + tracePad,
            origB[3] - tracePad
        ];

        var rasterTop = doc.rasterize(originalForTrace, paddedTraceBounds, rOptsTrace);
        doc.selection = null;
        rasterTop.selected = true;
        fastSleep(300);

        // =========================================================================
        // B2: ADJUST COLOR BALANCE TRÊN rasterTop (TẠO SILHOUETTE ĐEN)
        // =========================================================================
        logProcessStep("colorBalance", file, useInvert);
        doc.selection = null;
        rasterTop.selected = true;
        fastSleep(200);

        try {
            runActionSafe(ACTION_COLOR_BALANCE, actionSet);
            $.writeln("[colorBalance] Action '" + ACTION_COLOR_BALANCE + "' chạy thành công.");
        } catch (cbErr) {
            if (useInvert === false) {
                $.writeln("[colorBalance] Fallback Colors6 ở lượt retry: " + getErrorMessage(cbErr));
                app.executeMenuCommand("Colors6");
            } else {
                $.writeln("[colorBalance] Không tìm thấy Action '" + ACTION_COLOR_BALANCE + "', tiếp tục trace trực tiếp.");
            }
        }
        safeRedraw();
        fastSleep(1000);

        assertSelection("colorBalance", doc, 1);

        // =========================================================================
        // B3a: IMAGE TRACE VỚI PRESET "Low Fidelity Photo"
        // =========================================================================
        logProcessStep("trace", file, useInvert);
        var traceObj = doc.selection[0].trace();
        fastSleep(2000);

        traceObj.tracing.tracingOptions.loadFromPreset("Low Fidelity Photo");
        safeRedraw();
        fastSleep(2000);

        // =========================================================================
        // B3b: EXPAND TRACING THÀNH VECTOR PATHS
        // =========================================================================
        logProcessStep("expandTracing", file, useInvert);
        traceObj.tracing.expandTracing();
        fastSleep(3000);
        safeRedraw();

        if (!doc.selection || doc.selection.length === 0) {
            if (targetLayer.pageItems.length === 0) {
                throw new Error("Không tìm thấy object sau Expand");
            }
            for (var sIdx = 0; sIdx < targetLayer.pageItems.length; sIdx++) {
                if (targetLayer.pageItems[sIdx] !== fixedBottom && targetLayer.pageItems[sIdx].typename !== "RasterItem") {
                    targetLayer.pageItems[sIdx].selected = true;
                }
            }
        }

        // =========================================================================
        // B4a: UNGROUP - PHÂN RÃ CÁC GROUP LỒNG NHAU SAU EXPAND
        // =========================================================================
        logProcessStep("ungroup", file, useInvert);
        for (var ug = 0; ug < 4; ug++) {
            var hasSubGroup = false;
            for (var checkG = 0; checkG < targetLayer.pageItems.length; checkG++) {
                var checkItem = targetLayer.pageItems[checkG];
                if (checkItem !== fixedBottom && checkItem.typename === "GroupItem") {
                    hasSubGroup = true;
                    break;
                }
            }
            if (!hasSubGroup) break;
            app.executeMenuCommand("ungroup");
            fastSleep(250);
        }
        safeRedraw();

         // =========================================================================
        // B4b: CHỈ TÌM KIẾM VÀ XÓA DUY NHẤT 1 PATH TRẮNG CÓ FIT LỚN NHẤT
        //      (Giữ nguyên toàn bộ các path trắng nhỏ còn lại)
        // =========================================================================
        function isPathWhite(path) {
            if (!path || !path.filled) return false;
            var c = path.fillColor;
            if (!c) return false;
            if (c.typename === "CMYKColor") {
                return c.cyan < 5 && c.magenta < 5 && c.yellow < 5 && c.black < 5;
            } else if (c.typename === "RGBColor") {
                return c.red > 250 && c.green > 250 && c.blue > 250;
            } else if (c.typename === "GrayColor") {
                return c.gray < 5; // GrayColor: 0 = trắng (0% mực)
            }
            return false;
        }

        var largestWhitePath = null;
        var maxWhiteFitArea = -1;

        function findLargestWhitePath(item) {
            if (!item) return;
            try {
                if (item.typename === "GroupItem") {
                    for (var rwi = item.pageItems.length - 1; rwi >= 0; rwi--) {
                        findLargestWhitePath(item.pageItems[rwi]);
                    }
                } else if (item.typename === "CompoundPathItem") {
                    if (item.pathItems.length > 0 && isPathWhite(item.pathItems[0])) {
                        var b = item.geometricBounds; // [left, top, right, bottom]
                        var fitArea = Math.abs(b[2] - b[0]) * Math.abs(b[1] - b[3]);
                        if (fitArea > maxWhiteFitArea) {
                            maxWhiteFitArea = fitArea;
                            largestWhitePath = item;
                        }
                    }
                } else if (item.typename === "PathItem") {
                    if (isPathWhite(item)) {
                        var b2 = item.geometricBounds; // [left, top, right, bottom]
                        var fitArea2 = Math.abs(b2[2] - b2[0]) * Math.abs(b2[1] - b2[3]);
                        if (fitArea2 > maxWhiteFitArea) {
                            maxWhiteFitArea = fitArea2;
                            largestWhitePath = item;
                        }
                    }
                }
            } catch (e) { }
        }

        // 1. Duyệt tìm 1 path trắng có fit (width * height) lớn nhất
        for (var wi = targetLayer.pageItems.length - 1; wi >= 0; wi--) {
            try {
                var layerItem = targetLayer.pageItems[wi];
                if (layerItem === fixedBottom) continue;
                if (layerItem.typename === "RasterItem") continue;
                findLargestWhitePath(layerItem);
            } catch (e) { }
        }

        // 2. Chỉ xóa duy nhất 1 path trắng có fit lớn nhất vừa tìm được
        if (largestWhitePath) {
            try {
                largestWhitePath.remove();
                $.writeln("[B4b] Đã xóa 1 path trắng có fit lớn nhất (fitArea=" + Math.round(maxWhiteFitArea) + ").");
            } catch (e) {
                $.writeln("[B4b] Lỗi khi xóa path trắng có fit lớn nhất: " + getErrorMessage(e));
            }
        }
        fastSleep(300);

        // =========================================================================
        // B4c: GROUP LẠI CÁC PATH VECTOR CÒN LẠI → kissGroup
        // (Không chạy Unite để giữ nguyên toàn bộ các đường cắt chi tiết bên trong)
        // =========================================================================
        doc.selection = null;
        for (var gIdx = targetLayer.pageItems.length - 1; gIdx >= 0; gIdx--) {
            try {
                var gitm = targetLayer.pageItems[gIdx];
                if (gitm === fixedBottom || gitm.typename === "RasterItem") continue;
                gitm.selected = true;
            } catch (e) { }
        }

        if (!doc.selection || doc.selection.length === 0) {
            throw new Error("B4c: Không còn path nào sau khi xóa nền");
        }

        app.executeMenuCommand("group");
        fastSleep(300);
        safeRedraw();

        var kissGroup = (doc.selection && doc.selection.length > 0) ? doc.selection[0] : null;
        if (!kissGroup) {
            throw new Error("B4c: Không tạo được kissGroup");
        }

        // =========================================================================
        // B4.5: AUTO CROP fixedBottom THEO ĐƯỜNG KISSCUT CHUẨN XÁC
        // =========================================================================
        try {
            var tightBounds = kissGroup.geometricBounds;
            var rOptsCrop = new RasterizeOptions();
            rOptsCrop.resolution = 300;
            rOptsCrop.transparency = true;
            rOptsCrop.antiAliasingMethod = AntiAliasingMethod.ARTOPTIMIZED;

            doc.selection = null;
            fixedBottom.selected = true;

            fixedBottom = doc.rasterize(fixedBottom, tightBounds, rOptsCrop);
            doc.selection = null;
            fastSleep(300);
            $.writeln("[B4.5] Auto-crop ảnh thành công theo viền kissGroup.");
        } catch (cropErr) {
            $.writeln("[B4.5] Lỗi crop ảnh: " + getErrorMessage(cropErr));
        }

        // =========================================================================
        // B5a: TÔ MÀU STROKE ĐỎ CMYK CHO kissGroup, FILL = NONE
        // C:0 M:100 Y:100 K:0, stroke width 0.25pt
        // =========================================================================
        var cmykRed = new CMYKColor();
        cmykRed.cyan = 0;
        cmykRed.magenta = 100;
        cmykRed.yellow = 100;
        cmykRed.black = 0;

        function applyColorToItem(itm) {
            if (!itm) return;
            if (itm.typename === "GroupItem") {
                for (var aci = 0; aci < itm.pageItems.length; aci++) applyColorToItem(itm.pageItems[aci]);
            } else if (itm.typename === "CompoundPathItem") {
                for (var acj = 0; acj < itm.pathItems.length; acj++) applyColorToItem(itm.pathItems[acj]);
            } else if (itm.typename === "PathItem") {
                itm.filled = false;
                itm.stroked = true;
                itm.strokeColor = cmykRed;
                itm.strokeWidth = 0.25;
            }
        }

        applyColorToItem(kissGroup);
        safeRedraw();

        // =========================================================================
        // B5b: TẠO COMPOUND PATH & CLIPPING MASK
        // (Giữ nguyên kích thước biên cắt gốc của phôi Transparent, không Offset -1pt)
        // =========================================================================
        doc.selection = null;
        kissGroup.selected = true;
        fastSleep(300);

        app.executeMenuCommand("compoundPath");
        fastSleep(300);

        var origMaskPath = (doc.selection && doc.selection.length > 0) ? doc.selection[0] : kissGroup;
        applyColorToItem(origMaskPath);

        var duplicatedItem = origMaskPath.duplicate();
        applyColorToItem(duplicatedItem);

        doc.selection = null;
        fastSleep(500);

        var expandedGroup = targetLayer.groupItems.add();
        origMaskPath.move(expandedGroup, ElementPlacement.PLACEATBEGINNING);

        doc.selection = null;
        fastSleep(500);

        expandedGroup.selected = true;
        fixedBottom.selected = true;
        duplicatedItem.selected = false;
        fastSleep(1000);

        logProcessStep("makeMask", file, useInvert);

        var oldInteractionLevel = app.userInteractionLevel;
        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;

        app.executeMenuCommand("makeMask");

        app.userInteractionLevel = oldInteractionLevel;

        fastSleep(1000);
        safeRedraw();

        doc.selection = null;

        assertLayerItems("makeMask", targetLayer, 1);

        for (var k = 0; k < targetLayer.pageItems.length; k++) {
            try { targetLayer.pageItems[k].selected = true; } catch (e) { }
        }

        // =========================================================================
        // B5c: SCALE ARTWORK CHUẨN THEO CLIPPING MASK BOUNDS & VALIDATION
        // =========================================================================
        if (doc.selection.length > 0) {
            app.executeMenuCommand("group");
            var groupItem = doc.selection[0];

            var b = getClippingMaskBounds(groupItem);
            var width = Math.abs(b[2] - b[0]);
            var height = Math.abs(b[1] - b[3]);

            var longSide = Math.max(width, height);
            var scalePercent = (targetSize / longSide) * 100;

            logProcessStep("resize", file, useInvert);
            groupItem.resize(scalePercent, scalePercent, true, true, true, true, scalePercent);

            // Lần resize 2 để khử sai số làm tròn
            var b2 = getClippingMaskBounds(groupItem);
            var width2 = Math.abs(b2[2] - b2[0]);
            var height2 = Math.abs(b2[1] - b2[3]);
            var longSide2 = Math.max(width2, height2);
            var fixPercent = (targetSize / longSide2) * 100;

            groupItem.resize(fixPercent, fixPercent, true, true, true, true, fixPercent);

            app.executeMenuCommand("ungroup");
            doc.selection = null;
            targetLayer.hasSelectedArtwork = true;

            safeRedraw();
        }

        doc.selection = null;

        var check = hasRequiredItems(targetLayer);

        if (!check.ok) {
            try {
                targetLayer.locked = false;
                targetLayer.visible = true;
                targetLayer.remove();
            } catch (removeErr) { }
            throw new Error("Validation failed after full run.");
        }

        var finalGroup = groupAllPageItemsInLayer(doc, targetLayer);

        if (!finalGroup) {
            throw new Error("Không group được artwork cuối cùng ở layer " + targetLayer.name);
        }

        doc.selection = null;
        return finalGroup;
    }

    function getClippingMaskBounds(item) {
        var found = null;

        function scan(obj) {
            if (found) return;

            try {
                if (obj.typename === "GroupItem") {
                    if (obj.clipped) {
                        for (var i = 0; i < obj.pageItems.length; i++) {
                            var child = obj.pageItems[i];
                            if ((child.typename === "PathItem" || child.typename === "CompoundPathItem") && child.clipping) {
                                found = child.geometricBounds;
                                return;
                            }
                        }
                    }

                    for (var g = 0; g < obj.pageItems.length; g++) {
                        scan(obj.pageItems[g]);
                    }
                }
            } catch (e) { }
        }

        scan(item);

        if (found) return found;

        return item.geometricBounds;
    }

    function hasRequiredItems(layer) {
        var pathCount = 0;
        var clipGroupCount = 0;

        function scan(item) {
            if (item.typename === "PathItem" || item.typename === "CompoundPathItem") {
                pathCount++;
            } else if (item.typename === "GroupItem") {
                try {
                    if (item.clipped) {
                        clipGroupCount++;
                    } else {
                        for (var j = 0; j < item.pageItems.length; j++) {
                            scan(item.pageItems[j]);
                        }
                    }
                } catch (e) { }
            }
        }

        for (var i = 0; i < layer.pageItems.length; i++) {
            scan(layer.pageItems[i]);
        }

        return {
            ok: pathCount >= 1 && clipGroupCount >= 1,
            pathCount: pathCount,
            clipGroupCount: clipGroupCount
        };
    }

    function groupAllPageItemsInLayer(doc, layer) {
        doc.selection = null;

        for (var i = 0; i < layer.pageItems.length; i++) {
            try {
                layer.pageItems[i].selected = true;
            } catch (e) { }
        }

        if (doc.selection.length === 0) return null;

        if (doc.selection.length === 1 && doc.selection[0].typename === "GroupItem") {
            return doc.selection[0];
        }

        app.executeMenuCommand("group");
        fastSleep(300);

        return doc.selection.length > 0 ? doc.selection[0] : null;
    }

    // =========================================================================
    // 8) PHÂN CHIA NÉT CẮT KISS (CHUẨN HÓA PHÔI TRANSPARENT)
    // =========================================================================

    function ungroupTempFinalGroup(doc, finalGroup) {
        try {
            if (!finalGroup) return;
            var layer = finalGroup.layer;
            for (var i = finalGroup.pageItems.length - 1; i >= 0; i--) {
                finalGroup.pageItems[i].move(layer, ElementPlacement.PLACEATBEGINNING);
            }
            finalGroup.remove();
        } catch (e) { }
    }

    function moveCutPathsToTargetLayers(doc, sourceLayer, info) {
        var kissLayer = getOrCreateLayer(doc, "kiss");
        var invisibleLayer = getOrCreateLayer(doc, "invisible_bounds");
        var imageLayer = getOrCreateLayer(doc, "image");

        var paths = [];
        var otherItems = [];

        function collectCutItems(item) {
            try {
                if (!item) return;
                if (item.typename === "PathItem" || item.typename === "CompoundPathItem") {
                    paths.push(item);
                    return;
                }
                if (item.typename === "GroupItem") {
                    if (item.clipped) {
                        otherItems.push(item);
                        return;
                    }
                    for (var i = 0; i < item.pageItems.length; i++) {
                        collectCutItems(item.pageItems[i]);
                    }
                    return;
                }
                if (item.typename === "Layer") {
                    for (var j = 0; j < item.pageItems.length; j++) {
                        collectCutItems(item.pageItems[j]);
                    }
                    return;
                }
                if (item.typename === "RasterItem" || item.typename === "PlacedItem") {
                    otherItems.push(item);
                }
            } catch (e) { }
        }

        collectCutItems(sourceLayer);

        var offsetMM = 2.5;
        var baseOffsetPt = offsetMM * 2.834645669;

        function makeInvisible(itm) {
            if (!itm) return;
            if (itm.typename === "GroupItem") {
                for (var i = 0; i < itm.pageItems.length; i++) makeInvisible(itm.pageItems[i]);
            } else if (itm.typename === "CompoundPathItem") {
                for (var j = 0; j < itm.pathItems.length; j++) makeInvisible(itm.pathItems[j]);
            } else if (itm.typename === "PathItem") {
                itm.filled = false;
                itm.fillColor = new NoColor();
                itm.stroked = false;
                itm.strokeColor = new NoColor();
            }
        }

        // Khoảng cách offset cho rectangle bao quanh kiss: 2mm
        var kissRectOffsetMM = 2;
        var kissRectOffsetPt = kissRectOffsetMM * 2.834645669; // ≈ 5.6693pt

        for (var p = 0; p < paths.length; p++) {
            try {
                var pathItem = paths[p];

                var invPath = pathItem.duplicate();
                doc.selection = null;
                invPath.selected = true;
                app.redraw();
                var smallOffset = (baseOffsetPt * 0.5).toFixed(3);
                invPath.applyEffect('<LiveEffect name="Adobe Offset Path"><Dict data="R mlim 4.0 R ofst ' + smallOffset + ' I jntp 1 "/></LiveEffect>');
                app.redraw();
                fastSleep(200);
                app.executeMenuCommand("expandStyle");
                fastSleep(200);
                var finalInvPath = doc.selection.length > 0 ? doc.selection[0] : invPath;
                makeInvisible(finalInvPath);
                finalInvPath.move(invisibleLayer, ElementPlacement.PLACEATBEGINNING);

                pathItem.move(kissLayer, ElementPlacement.PLACEATBEGINNING);

                // =====================================================================
                // VẼ RECTANGLE BAO QUANH KISS PATH (cách đường kiss 2mm mỗi phía)
                // =====================================================================
                try {
                    var kb = pathItem.geometricBounds; // [left, top, right, bottom]
                    var kLeft   = kb[0] - kissRectOffsetPt;
                    var kTop    = kb[1] + kissRectOffsetPt;
                    var kRight  = kb[2] + kissRectOffsetPt;
                    var kBottom = kb[3] - kissRectOffsetPt;

                    var kW = kRight - kLeft;
                    var kH = kTop - kBottom;

                    // Tạo rectangle bằng pathItems.add() và set pathPoints thủ công
                    // để tránh phụ thuộc vào activeLayer
                    var rectPath = kissLayer.pathItems.add();
                    rectPath.setEntirePath([
                        [kLeft,  kTop],
                        [kRight, kTop],
                        [kRight, kBottom],
                        [kLeft,  kBottom]
                    ]);
                    rectPath.closed = true;
                    rectPath.filled = false;
                    rectPath.fillColor = new NoColor();
                    rectPath.stroked = true;

                    var rectStrokeColor = new CMYKColor();
                    rectStrokeColor.cyan    = 0;
                    rectStrokeColor.magenta = 100;
                    rectStrokeColor.yellow  = 100;
                    rectStrokeColor.black   = 0;
                    rectPath.strokeColor = rectStrokeColor;
                    rectPath.strokeWidth = 0.25;

                    $.writeln("[kissRect] Đã vẽ rectangle bao kiss (offset " + kissRectOffsetMM + "mm): "
                        + "L=" + kLeft.toFixed(2) + " T=" + kTop.toFixed(2)
                        + " W=" + kW.toFixed(2) + " H=" + kH.toFixed(2));
                } catch (rectErr) {
                    $.writeln("[kissRect] Lỗi vẽ rectangle: " + getErrorMessage(rectErr));
                }

            } catch (e) { }
        }

        for (var m = 0; m < otherItems.length; m++) {
            try {
                otherItems[m].move(imageLayer, ElementPlacement.PLACEATBEGINNING);
            } catch (e) { }
        }

        try {
            if (sourceLayer && sourceLayer.name.indexOf(AUTO_LAYER_PREFIX) !== -1) {
                sourceLayer.locked = false;
                sourceLayer.visible = true;
                sourceLayer.remove();
            }
        } catch (e) { }
    }

    function getOrCreateLayer(doc, layerName) {
        try {
            return doc.layers[layerName];
        } catch (e) {
            var l = doc.layers.add();
            l.name = layerName;
            return l;
        }
    }

    // =========================================================================
    // 9) LƯU FILE, QUẢN LÝ SHEET & WAIT METADATA
    // =========================================================================

    function safeJsonStringifyRects(rects) {
        if (typeof JSON !== "undefined" && JSON.stringify) {
            return JSON.stringify(rects, null, 2);
        }

        if (!rects || !rects.length) return "[]";

        var parts = [];
        for (var i = 0; i < rects.length; i++) {
            var r = rects[i];
            parts.push(
                '{"x":' + Number(r.x) +
                ',"y":' + Number(r.y) +
                ',"w":' + Number(r.w) +
                ',"h":' + Number(r.h) + "}"
            );
        }
        return "[\n" + parts.join(",\n") + "\n]";
    }

    function safeJsonParseRects(jsonText) {
        if (!jsonText) return null;

        if (typeof JSON !== "undefined" && JSON.parse) {
            var parsed = JSON.parse(jsonText);
            return parsed && parsed.length ? parsed : [];
        }

        var rects = [];
        var re = /\{\s*"x"\s*:\s*([-0-9.]+)\s*,\s*"y"\s*:\s*([-0-9.]+)\s*,\s*"w"\s*:\s*([-0-9.]+)\s*,\s*"h"\s*:\s*([-0-9.]+)\s*\}/g;
        var m;
        while ((m = re.exec(jsonText)) !== null) {
            rects.push({
                x: parseFloat(m[1]),
                y: parseFloat(m[2]),
                w: parseFloat(m[3]),
                h: parseFloat(m[4])
            });
        }
        return rects;
    }

    function readWaitMetaJson(waitMetaFolder, baseName, maxInch) {
        try {
            if (!waitMetaFolder || !waitMetaFolder.exists) return null;

            var sizePart = String(maxInch).replace(".", "_");
            var metaFile = new File(waitMetaFolder.fsName + "/" + baseName + "_wait_" + sizePart + ".json");
            if (!metaFile.exists) {
                metaFile = new File(waitMetaFolder.fsName + "/" + baseName + "wait" + sizePart + ".json");
            }
            if (!metaFile.exists) return null;

            if (!metaFile.open("r")) {
                throw new Error("Cannot open meta file for read: " + metaFile.fsName);
            }

            metaFile.encoding = "UTF-8";
            var jsonText = metaFile.read();
            metaFile.close();

            if (!jsonText) return null;

            var parsed = safeJsonParseRects(jsonText);
            return (parsed && parsed.length) ? parsed : null;
        } catch (e) {
            $.writeln("Error reading wait-meta.json: " + getErrorMessage(e));
            return null;
        }
    }

    function mergeUsedRects(oldRects, newRects) {
        var merged = [];
        var seen = {};

        function rectKey(r) {
            return r.x + "," + r.y + "," + r.w + "," + r.h;
        }

        if (oldRects && oldRects.length) {
            for (var i = 0; i < oldRects.length; i++) {
                var key = rectKey(oldRects[i]);
                if (!seen[key]) {
                    merged.push(oldRects[i]);
                    seen[key] = true;
                }
            }
        }

        if (newRects && newRects.length) {
            for (var j = 0; j < newRects.length; j++) {
                var key2 = rectKey(newRects[j]);
                if (!seen[key2]) {
                    merged.push(newRects[j]);
                    seen[key2] = true;
                }
            }
        }

        return merged;
    }

    function readNoteFileIds(folder, baseName) {
        try {
            var txtFile = new File(folder.fsName + "/" + baseName + ".txt");
            if (!txtFile.exists) return [];

            if (!txtFile.open("r")) return [];

            txtFile.encoding = "UTF-8";
            var content = txtFile.read();
            txtFile.close();

            if (!content) return [];

            var ids = content.split(",");
            var result = [];
            var seen = {};
            for (var i = 0; i < ids.length; i++) {
                var id = trim(ids[i]);
                if (id && !seen[id]) {
                    result.push(id);
                    seen[id] = true;
                }
            }
            return result;
        } catch (e) {
            return [];
        }
    }

    function writeDoneNoteFile(folder, baseName, idList) {
        try {
            if (!folder.exists) folder.create();
            var txtFile = new File(folder.fsName + "/" + baseName + ".txt");
            var uniqueIds = [];
            var seen = {};

            if (idList && idList.length) {
                for (var i = 0; i < idList.length; i++) {
                    var id = trim(String(idList[i]));
                    if (id && !seen[id]) {
                        seen[id] = true;
                        uniqueIds.push(id);
                    }
                }
            }

            if (txtFile.open("w")) {
                txtFile.encoding = "UTF-8";
                txtFile.write(uniqueIds.join(","));
                txtFile.close();
            }
        } catch (e) {
            $.writeln("Warning: Không ghi được file note_done: " + getErrorMessage(e));
        }
    }

    function writeWaitMetaJsonByFileName(waitMetaFolder, fileNameNoExtension, usedRects) {
        if (!waitMetaFolder.exists) {
            if (!waitMetaFolder.create()) {
                throw new Error("Cannot create wait-meta folder: " + waitMetaFolder.fsName);
            }
        }

        var metaFile = new File(waitMetaFolder.fsName + "/" + fileNameNoExtension + ".json");
        var jsonText = safeJsonStringifyRects(usedRects);

        if (!metaFile.open("w")) {
            throw new Error("Cannot open meta file for write: " + metaFile.fsName);
        }

        metaFile.encoding = "UTF-8";
        metaFile.write(jsonText);
        metaFile.close();

        if (!metaFile.exists) {
            throw new Error("Meta file was not created: " + metaFile.fsName);
        }
    }

    function saveCurrentSheetAs(doc, outFolder, idList, waitMetaFolder, doneFolder, forceWaitSave, waitInchOverride) {
        if (!outFolder.exists) outFolder.create();
        if (!noteDoneFolder.exists) noteDoneFolder.create();
        if (!waitFolder.exists) waitFolder.create();
        if (waitMetaFolder && !waitMetaFolder.exists) waitMetaFolder.create();

        var baseName = RUN_WAIT_MODE ? WAIT_BASE_NAME : makeTimeFileName();
        var waitInfo = getWaitInfo(packer);
        var isWaitSave = (forceWaitSave === true) || (waitInfo && waitInfo.count > 0);

        if (forceWaitSave && !waitInfo) {
            waitInfo = {
                inch: waitInchOverride || 1.5,
                count: currentSheetDoneFiles.length
            };
        }

        var saveFolder = isWaitSave ? waitFolder : outFolder;
        var saveBaseName = baseName;
        if (isWaitSave) {
            saveBaseName = baseName + "_wait_" + String(waitInfo.inch).replace(".", "_");
        }

        if (RUN_WAIT_MODE && isWaitSave && waitInfo) {
            try {
                var usedRectsNow = packer.getUsedRects();
                writeWaitMetaJsonByFileName(waitMetaFolder, saveBaseName, usedRectsNow);
            } catch (earlyMetaErr) { }
        }

        var outFile = isWaitSave
            ? new File(saveFolder.fsName + "/" + saveBaseName + ".ai")
            : uniqueAiFile(saveFolder, saveBaseName);

        var opts = new IllustratorSaveOptions();
        opts.compatibility = Compatibility.ILLUSTRATOR17;
        opts.pdfCompatible = true;

        doc.selection = null;

        var idListToWrite = idList;

        if (RUN_WAIT_MODE && isWaitSave && WAIT_BASE_NAME && WAIT_MAX_INCH) {
            try {
                var oldSizePart = String(WAIT_MAX_INCH).replace(".", "_");
                var oldMetaFileName = WAIT_BASE_NAME + "_wait_" + oldSizePart + ".json";
                var oldMetaFile = new File(waitMetaFolder.fsName + "/" + oldMetaFileName);

                if (oldMetaFile.exists && oldSizePart !== String(waitInfo.inch).replace(".", "_")) {
                    var oldUsedRects = readWaitMetaJson(waitMetaFolder, WAIT_BASE_NAME, WAIT_MAX_INCH);
                    var newUsedRects = packer.getUsedRects();
                    var mergedRects = mergeUsedRects(oldUsedRects, newUsedRects);
                    writeWaitMetaJsonByFileName(waitMetaFolder, saveBaseName, mergedRects);
                }
            } catch (metaMergeErr) { }

            try {
                var oldNoteBaseName = WAIT_BASE_NAME + "_wait_" + String(WAIT_MAX_INCH).replace(".", "_");
                var oldNoteFile = new File(noteDoneFolder.fsName + "/" + oldNoteBaseName + ".txt");

                if (oldNoteFile.exists && String(WAIT_MAX_INCH).replace(".", "_") !== String(waitInfo.inch).replace(".", "_")) {
                    var oldIds = readNoteFileIds(noteDoneFolder, oldNoteBaseName);
                    idListToWrite = (oldIds && oldIds.length > 0) ? oldIds.concat(idList) : idList;
                }
            } catch (noteMergeErr) { }
        }

        if (!isWaitSave && RUN_WAIT_MODE && WAIT_BASE_NAME && WAIT_MAX_INCH) {
            try {
                var oldNoteBaseName2 = WAIT_BASE_NAME + "_wait_" + String(WAIT_MAX_INCH).replace(".", "_");
                var oldIds2 = readNoteFileIds(noteDoneFolder, oldNoteBaseName2);
                if (oldIds2 && oldIds2.length > 0) {
                    idListToWrite = oldIds2.concat(idListToWrite);
                }
            } catch (noteMergeErr2) { }
        }

        if (isWaitSave && outFile.exists) {
            try { outFile.remove(); } catch (removeErr) { }
        }

        if (isWaitSave && waitInfo) {
            try {
                var usedRectsToSave = packer.getUsedRects();
                writeWaitMetaJsonByFileName(waitMetaFolder, saveBaseName, usedRectsToSave);
            } catch (metaErr) {
                throw new Error("Cannot save wait-meta.json before saveAs: " + getErrorMessage(metaErr));
            }
        }

        var reservedLayers = hideReservedLayersForSave(doc, saveFolder, outFolder);

        try {
            doc.saveAs(outFile, opts);
        } finally {
            restoreReservedLayersVisibility(reservedLayers);
        }

        // if (!isWaitSave) {
        //     try {
        //         exportPngTransparent(doc, outFile.name);
        //     } catch (pngErr) {
        //         $.writeln("Warning: Không export được PNG: " + getErrorMessage(pngErr));
        //     }
        // }

        removeWorkNote();
        SHOULD_CLOSE_AFTER_SAVE = true;

        var finalBaseName = stripExt(outFile.name);
        writeDoneNoteFile(noteDoneFolder, finalBaseName, idListToWrite);

        try {
            if (typeof moveQueuedDoneFiles === "function") {
                moveQueuedDoneFiles(doneFolder);
            }
        } catch (e) {
            $.writeln("Warning moving queued done files: " + getErrorMessage(e));
        }

        try {
            app.userInteractionLevel = OLD_USER_INTERACTION_LEVEL;
        } catch (e) { }

        try {
            doc.close(SaveOptions.DONOTSAVECHANGES);
        } catch (e) { }

        if (RUN_WAIT_MODE && isWaitSave && WAIT_BASE_NAME && WAIT_MAX_INCH) {
            var oldFileBaseName = WAIT_BASE_NAME + "_wait_" + String(WAIT_MAX_INCH).replace(".", "_");
            if (oldFileBaseName !== saveBaseName) {
                try {
                    var oldAiFile = new File(waitFolder.fsName + "/" + oldFileBaseName + ".ai");
                    if (oldAiFile.exists) oldAiFile.remove();
                } catch (e) { }
                try {
                    var oldJsonFile = new File(waitMetaFolder.fsName + "/" + oldFileBaseName + ".json");
                    if (oldJsonFile.exists) oldJsonFile.remove();
                } catch (e) { }
                try {
                    var oldTxtFile = new File(noteDoneFolder.fsName + "/" + oldFileBaseName + ".txt");
                    if (oldTxtFile.exists) oldTxtFile.remove();
                } catch (e) { }
            }
        }

        if (!isWaitSave) {
            if (RUN_WAIT_MODE && WAIT_BASE_NAME) {
                try {
                    var waitFilesInFolder = waitFolder.getFiles();
                    if (waitFilesInFolder && waitFilesInFolder.length > 0) {
                        for (var idx = 0; idx < waitFilesInFolder.length; idx++) {
                            var wf = waitFilesInFolder[idx];
                            if (!(wf instanceof File)) continue;
                            var fmatch = wf.name.match(/^(.*)_wait_([0-9]+(?:_[0-9]+)?)\.ai$/i);
                            if (fmatch && fmatch[1] === WAIT_BASE_NAME) {
                                try { wf.remove(); } catch (re) { }
                            }
                        }
                    }
                } catch (e) { }

                try {
                    var metaFilesInFolder = waitMetaFolder.getFiles();
                    if (metaFilesInFolder && metaFilesInFolder.length > 0) {
                        for (var jdx = 0; jdx < metaFilesInFolder.length; jdx++) {
                            var mf = metaFilesInFolder[jdx];
                            if (!(mf instanceof File)) continue;
                            var mmatch = mf.name.match(/^(.*)_wait_([0-9]+(?:_[0-9]+)?)\.json$/i);
                            if (mmatch && mmatch[1] === WAIT_BASE_NAME) {
                                try { mf.remove(); } catch (me) { }
                            }
                        }
                    }
                } catch (e) { }

                try {
                    var noteFilesInFolder = noteDoneFolder.getFiles();
                    if (noteFilesInFolder && noteFilesInFolder.length > 0) {
                        for (var ndx = 0; ndx < noteFilesInFolder.length; ndx++) {
                            var nf = noteFilesInFolder[ndx];
                            if (!(nf instanceof File)) continue;
                            var nmatch = nf.name.match(/^(.*)_wait_([0-9]+(?:_[0-9]+)?)\.txt$/i);
                            if (nmatch && nmatch[1] === WAIT_BASE_NAME) {
                                try { nf.remove(); } catch (ne) { }
                            }
                        }
                    }
                } catch (e) { }
            }

            if (RUN_WAIT_MODE && WAIT_SOURCE_FILE && WAIT_SOURCE_FILE.exists) {
                try { WAIT_SOURCE_FILE.remove(); } catch (e) { }
            }
        }
    }

    function exportPngTransparent(doc, aiFileName) {
        var pngFolder = new Folder(PNG_FOLDER);
        if (!pngFolder.exists) pngFolder.create();

        var pngBaseName = aiFileName.replace(/\.ai$/i, "");
        var pngFile = new File(pngFolder.fsName + "/" + pngBaseName + ".png");

        var layerStates = [];
        var hideNames = ["kiss", "invisible_bounds"];
        for (var i = 0; i < hideNames.length; i++) {
            try {
                var lyr = doc.layers[hideNames[i]];
                if (lyr) {
                    layerStates.push({ layer: lyr, visible: lyr.visible });
                    lyr.visible = false;
                }
            } catch (e) { }
        }

        try {
            var exportOpts = new ExportOptionsPNG24();
            exportOpts.antiAliasing = true;
            exportOpts.transparency = true;
            exportOpts.artBoardClipping = true;
            exportOpts.resolution = 300;
            exportOpts.horizontalScale = 100;
            exportOpts.verticalScale = 100;

            doc.exportFile(pngFile, ExportType.PNG24, exportOpts);
            $.writeln("Exported PNG: " + pngFile.fsName);
        } finally {
            for (var j = 0; j < layerStates.length; j++) {
                try {
                    layerStates[j].layer.visible = layerStates[j].visible;
                } catch (e) { }
            }
        }
    }

    function hideReservedLayersForSave(doc, saveFolder, outFolder) {
        var layerNames = ["kiss"];
        var states = [];
        var shouldHide = false;

        try {
            shouldHide = saveFolder && outFolder && saveFolder.fsName === outFolder.fsName;
        } catch (e) {
            shouldHide = false;
        }

        for (var i = 0; i < layerNames.length; i++) {
            try {
                var layer = doc.layers[layerNames[i]];
                if (!layer) continue;

                states.push({ layer: layer, visible: layer.visible });
                if (shouldHide) {
                    layer.visible = false;
                }
            } catch (e) { }
        }

        return states;
    }

    function restoreReservedLayersVisibility(states) {
        if (!states) return;

        for (var i = 0; i < states.length; i++) {
            try {
                states[i].layer.visible = states[i].visible;
            } catch (e) { }
        }
    }

    function getWaitInfo(packer) {
        return null;
    }

    function pad2(n) {
        return (n < 10 ? "0" : "") + n;
    }

    function makeTimeFileName() {
        var d = new Date();
        var month = d.getMonth() + 1;
        var day = d.getDate();
        var hour = pad2(d.getHours());
        var minute = pad2(d.getMinutes());
        var second = pad2(d.getSeconds());
        var ms = d.getMilliseconds();
        return month + "_" + day + "_" + hour + "_" + minute + "_" + second + "_" + ms;
    }

    // =========================================================================
    // 3) PARSE TÊN FILE CHUẨN TRANSPARENT & TÍNH KHOẢNG ĐỆM (gapPt)
    // =========================================================================
    function parseFileName(fileName) {
        var cleanName = cleanFileName(fileName);
        var base = stripExt(cleanName);

        var id = "";
        var inch = NaN;
        var qty = 1;
        var stt = "";
        var fileType = "transparent";

        var matchType = base.match(/(transparent|tranfarent)/i);
        if (matchType) {
            var prefix = base.substring(0, matchType.index);
            id = prefix.replace(/[\s\-_]+$/, "");
        } else if (/[\-_]trans\b/i.test(base)) {
            var mTrans = base.match(/[\-_]trans\b/i);
            var prefixTrans = base.substring(0, mTrans.index);
            id = prefixTrans.replace(/[\s\-_]+$/, "");
        } else {
            throw new Error("Không tìm thấy từ khóa 'transparent' trong tên file: " + fileName);
        }

        if (!id) {
            throw new Error("Không xác định được mã ID sản phẩm trước từ khóa 'transparent' trong tên file: " + fileName);
        }

        var hasQtyTag = false;
        var qtyMatch = base.match(/([\-_]?qty[\-_]?)(\d+)(?!.*[\-_]?qty)/i);
        if (qtyMatch) {
            qty = parseInt(qtyMatch[2], 10);
            hasQtyTag = true;
        }

        if (isNaN(qty) || qty <= 0) {
            throw new Error("Số lượng (qty) không hợp lệ trong tên file: " + fileName);
        }

        var foundInch = false;
        var searchArea = matchType ? base.substring(matchType.index) : base;
        var inchMatch = searchArea.match(/(?:[\s\-_]|^)(\d+(?:[\.,]\d+)?)\s*(?:in|inch)\b/i);
        if (!inchMatch) {
            inchMatch = base.match(/(?:[\s\-_]|^)(\d+(?:[\.,]\d+)?)\s*(?:in|inch)\b/i);
        }

        if (inchMatch) {
            inch = parseFloat(inchMatch[1].replace(/,/g, "."));
            if (!isNaN(inch) && inch > 0) {
                foundInch = true;
            }
        }

        var remainingParts = [];
        if (matchType) {
            var suffix = base.substring(matchType.index + matchType[0].length);
            if (qtyMatch) {
                suffix = suffix.replace(qtyMatch[0], "");
            }
            var suffixParts = suffix.split(/[\-_]/);
            for (var i = 0; i < suffixParts.length; i++) {
                var p = trim(suffixParts[i]);
                if (!p) continue;

                if (!foundInch) {
                    var parsedInch = parseInch(p);
                    if (!isNaN(parsedInch) && parsedInch > 0) {
                        inch = parsedInch;
                        foundInch = true;
                        continue;
                    }
                }

                if (foundInch && (p.toLowerCase() === inch + "in" || p.toLowerCase() === inch + "inch")) {
                    continue;
                }

                remainingParts.push(p);
            }
        }

        if (!foundInch || isNaN(inch) || inch <= 0) {
            throw new Error("Không đọc được kích thước (size inch) từ file: " + fileName);
        }

        stt = remainingParts.join("-");

        var isSll = /\bSLL\b/i.test(base);

        var paddingMM = 2.5;
        var gapPt = paddingMM * 2.834645669;

        return {
            id: id,
            sizeText: inch + "in",
            inch: inch,
            qty: qty,
            stt: stt,
            isSll: isSll,
            isTransparent: true,
            isDinhHinh: true,
            fileType: fileType,
            gapPt: gapPt,
            targetSizePt: getCorrectedTargetPt(inch),
            base: base,
            hasQtyTag: hasQtyTag
        };
    }

    function parseInch(sizeText) {
        var s = cleanFileName(sizeText).toLowerCase();
        s = s.replace(/,/g, ".");
        s = s.replace(/\s/g, "");
        s = s.replace(/inch(es)?/g, "in");

        var m = s.match(/(\d+(?:\.\d+)?)in/);
        if (!m) m = s.match(/(\d+(?:\.\d+)?)/);
        if (!m) return NaN;

        return parseFloat(m[1]);
    }

    function logProcessStep(stepName, file, useInvert) {
        try {
            $.writeln(
                "[process-step] " + stepName +
                " | file=" + (file ? file.fsName : "") +
                " | invert=" + (useInvert === false ? "false" : "true")
            );

            if (typeof DEBUG_STEP_MODE !== "undefined" && DEBUG_STEP_MODE) {
                try {
                    app.redraw();
                } catch (rErr) { }

                var fileNameStr = file ? file.name : "N/A";
                var invertStr = (useInvert === false ? "Tắt (false)" : "Bật (true)");
                var msg = "=== DEBUG STEP MODE ===\n\n" +
                    "Bước hiện tại: " + String(stepName).toUpperCase() + "\n" +
                    "File ảnh: " + fileNameStr + "\n" +
                    "Invert Mode: " + invertStr + "\n\n" +
                    "• Chọn [OK] để tiếp tục bước tiếp theo.\n" +
                    "• Chọn [Cancel] để dừng chương trình.";

                var ok = confirm(msg);
                if (!ok) {
                    throw new Error("STOP_BY_USER_DEBUG: Người dùng chủ động dừng ở bước [" + stepName + "]");
                }
            }
        } catch (e) {
            if (e.message && e.message.indexOf("STOP_BY_USER_DEBUG") !== -1) {
                throw e;
            }
        }
    }

    function assertSelection(stepName, doc, minCount) {
        minCount = minCount || 1;
        if (!doc.selection || doc.selection.length < minCount) {
            throw new Error(stepName + ": selection not ready");
        }
    }

    function assertLayerItems(stepName, layer, minCount) {
        minCount = minCount || 1;
        if (!layer || !layer.pageItems || layer.pageItems.length < minCount) {
            throw new Error(stepName + ": no artwork on target layer");
        }
    }

    // =========================================================================
    // 5) SMART PACKER (MAXRECTS BIN PACKING ALGORITHM)
    // =========================================================================
    function createSmartPacker(doc, margin, gap, allowRotate, waitBaseName, waitMaxInch, waitMetaFolder) {
        var areaRect = doc.artboards[doc.artboards.getActiveArtboardIndex()].artboardRect;
        try {
            var kissLayer = doc.layers.getByName("kiss");
            if (kissLayer && kissLayer.pathItems && kissLayer.pathItems.length > 0) {
                var kb = kissLayer.pathItems[0].geometricBounds;
                for (var ki = 1; ki < kissLayer.pathItems.length; ki++) {
                    var tb = kissLayer.pathItems[ki].geometricBounds;
                    if (tb[0] < kb[0]) kb[0] = tb[0];
                    if (tb[1] > kb[1]) kb[1] = tb[1];
                    if (tb[2] > kb[2]) kb[2] = tb[2];
                    if (tb[3] < kb[3]) kb[3] = tb[3];
                }
                areaRect = kb;
            }
        } catch (e) { }

        var safeMargin = margin + 5;
        var left = areaRect[0] + safeMargin;
        var top = areaRect[1] - safeMargin;
        var right = areaRect[2] - safeMargin;
        var bottomArea = areaRect[3] + safeMargin;

        var binW = Math.abs(right - left);
        var binH = Math.abs(top - bottomArea);

        var freeRects = [{ x: left, y: top, w: binW, h: binH }];
        var usedRects = [];

        function normalizeLoadedRects(rects) {
            var out = [];
            if (!rects || !rects.length) return out;

            for (var i = 0; i < rects.length; i++) {
                var r = rects[i];
                if (!r) continue;

                var x = Number(r.x);
                var y = Number(r.y);
                var w = Number(r.w);
                var h = Number(r.h);

                if (isNaN(x) || isNaN(y) || isNaN(w) || isNaN(h)) continue;
                if (w <= 2 || h <= 2) continue;

                out.push({ x: x, y: y, w: w, h: h });
            }

            return out;
        }

        function rectsOverlap(a, b) {
            var aLeft = a.x;
            var aRight = a.x + a.w;
            var aTop = a.y;
            var aBottom = a.y - a.h;

            var bLeft = b.x;
            var bRight = b.x + b.w;
            var bTop = b.y;
            var bBottom = b.y - b.h;

            return !(aRight <= bLeft || aLeft >= bRight || aBottom >= bTop || aTop <= bBottom);
        }

        function isContainedIn(a, b) {
            return (
                a.x >= b.x &&
                a.y <= b.y &&
                a.x + a.w <= b.x + b.w &&
                a.y - a.h >= b.y - b.h
            );
        }

        function splitFreeNode(freeNode, usedNode, out) {
            if (!rectsOverlap(freeNode, usedNode)) {
                out.push(freeNode);
                return;
            }

            var freeLeft = freeNode.x;
            var freeRight = freeNode.x + freeNode.w;
            var freeTop = freeNode.y;
            var freeBottom = freeNode.y - freeNode.h;

            var usedLeft = usedNode.x;
            var usedRight = usedNode.x + usedNode.w;
            var usedTop = usedNode.y;
            var usedBottom = usedNode.y - usedNode.h;

            if (usedTop < freeTop && usedTop > freeBottom) {
                out.push({ x: freeLeft, y: freeTop, w: freeNode.w, h: freeTop - usedTop });
            }

            if (usedBottom > freeBottom && usedBottom < freeTop) {
                out.push({ x: freeLeft, y: usedBottom, w: freeNode.w, h: usedBottom - freeBottom });
            }

            if (usedLeft > freeLeft && usedLeft < freeRight) {
                out.push({ x: freeLeft, y: freeTop, w: usedLeft - freeLeft, h: freeNode.h });
            }

            if (usedRight < freeRight && usedRight > freeLeft) {
                out.push({ x: usedRight, y: freeTop, w: freeRight - usedRight, h: freeNode.h });
            }
        }

        function pruneFreeRects() {
            for (var i = freeRects.length - 1; i >= 0; i--) {
                if (freeRects[i].w <= 2 || freeRects[i].h <= 2) freeRects.splice(i, 1);
            }

            for (var a = freeRects.length - 1; a >= 0; a--) {
                for (var b = freeRects.length - 1; b >= 0; b--) {
                    if (a === b) continue;
                    if (isContainedIn(freeRects[a], freeRects[b])) {
                        freeRects.splice(a, 1);
                        break;
                    }
                }
            }

            freeRects.sort(function (r1, r2) {
                if (r2.y !== r1.y) return r2.y - r1.y;
                return r1.x - r2.x;
            });
        }

        function rebuildFreeRectsFromUsedRects() {
            freeRects = [{ x: left, y: top, w: binW, h: binH }];

            for (var i = 0; i < usedRects.length; i++) {
                var r = usedRects[i];
                var newFreeRects = [];

                for (var j = 0; j < freeRects.length; j++) {
                    splitFreeNode(freeRects[j], r, newFreeRects);
                }

                freeRects = newFreeRects;
                pruneFreeRects();
            }
        }

        function collectPackPathItems(item, arr) {
            try {
                if (item.typename === "PathItem" || item.typename === "CompoundPathItem") {
                    arr.push(item);
                    return;
                }
                if (item.typename === "GroupItem") {
                    try {
                        if (item.clipped) return;
                    } catch (clipErr) { }
                    for (var i = 0; i < item.pageItems.length; i++) {
                        collectPackPathItems(item.pageItems[i], arr);
                    }
                }
            } catch (e) { }
        }

        function unionBounds(boundsList) {
            if (!boundsList || !boundsList.length) return null;

            var l = boundsList[0][0];
            var t = boundsList[0][1];
            var r = boundsList[0][2];
            var b = boundsList[0][3];

            for (var i = 1; i < boundsList.length; i++) {
                var bb = boundsList[i];
                if (bb[0] < l) l = bb[0];
                if (bb[1] > t) t = bb[1];
                if (bb[2] > r) r = bb[2];
                if (bb[3] < b) b = bb[3];
            }

            return [l, t, r, b];
        }

        function getArtworkPackBounds(item) {
            var paths = [];
            var boundsList = [];
            collectPackPathItems(item, paths);

            for (var i = 0; i < paths.length; i++) {
                try {
                    boundsList.push(paths[i].visibleBounds || paths[i].geometricBounds);
                } catch (e) { }
            }

            var ub = unionBounds(boundsList);
            return ub || item.visibleBounds || item.geometricBounds;
        }

        function getItemSize(item) {
            var b = getArtworkPackBounds(item);
            return { w: Math.abs(b[2] - b[0]), h: Math.abs(b[1] - b[3]) };
        }

        function findBestRect(w, h) {
            var best = null;

            for (var i = 0; i < freeRects.length; i++) {
                var r = freeRects[i];

                if (w <= r.w && h <= r.h) {
                    var cand = { index: i, rect: r, rotated: false, x: r.x, y: r.y, w: w, h: h };
                    var scoreX = r.x;
                    var scoreY = r.y;
                    if (!best || scoreX < best.scoreX || (Math.abs(scoreX - best.scoreX) < 0.1 && scoreY > best.scoreY)) {
                        cand.scoreX = scoreX;
                        cand.scoreY = scoreY;
                        best = cand;
                    }
                }

                if (allowRotate && h <= r.w && w <= r.h) {
                    var candRot = { index: i, rect: r, rotated: true, x: r.x, y: r.y, w: h, h: w };
                    var scoreXR = r.x;
                    var scoreYR = r.y;
                    if (!best || scoreXR < best.scoreX || (Math.abs(scoreXR - best.scoreX) < 0.1 && scoreYR > best.scoreY)) {
                        candRot.scoreX = scoreXR;
                        candRot.scoreY = scoreYR;
                        best = candRot;
                    }
                }
            }

            return best;
        }

        function registerUsedRect(placedRect, itemGapPt) {
            var currentGap = itemGapPt || gap;
            var occupied = {
                x: placedRect.x - currentGap,
                y: placedRect.y + currentGap,
                w: placedRect.w + currentGap * 2,
                h: placedRect.h + currentGap * 2
            };

            usedRects.push(occupied);

            var newFreeRects = [];
            for (var i = 0; i < freeRects.length; i++) {
                splitFreeNode(freeRects[i], occupied, newFreeRects);
            }

            freeRects = newFreeRects;
            pruneFreeRects();
        }

        function moveItemTopLeftTo(item, targetLeft, targetTop) {
            var b = getArtworkPackBounds(item);
            var dx = targetLeft - b[0];
            var dy = targetTop - b[1];
            item.translate(dx, dy);
        }

        function mergeUsedRectsFromSource(rects) {
            if (!rects || !rects.length) return;

            var seen = {};
            for (var i = 0; i < usedRects.length; i++) {
                var exist = usedRects[i];
                var existKey = [
                    Math.round(exist.x * 100) / 100,
                    Math.round(exist.y * 100) / 100,
                    Math.round(exist.w * 100) / 100,
                    Math.round(exist.h * 100) / 100
                ].join("|");
                seen[existKey] = true;
            }

            for (var j = 0; j < rects.length; j++) {
                var rr = rects[j];
                var key = [
                    Math.round(rr.x * 100) / 100,
                    Math.round(rr.y * 100) / 100,
                    Math.round(rr.w * 100) / 100,
                    Math.round(rr.h * 100) / 100
                ].join("|");

                if (seen[key]) continue;
                seen[key] = true;
                usedRects.push(rr);
            }
        }

        var loadedRects = null;
        if (waitBaseName && waitMaxInch && waitMetaFolder) {
            loadedRects = normalizeLoadedRects(readWaitMetaJson(waitMetaFolder, waitBaseName, waitMaxInch));
        }

        if (loadedRects && loadedRects.length > 0) {
            mergeUsedRectsFromSource(loadedRects);
        }

        rebuildFreeRectsFromUsedRects();

        return {
            getBinSize: function () {
                return { w: binW, h: binH };
            },
            canFit: function (w, h) {
                return findBestRect(w, h) !== null;
            },
            countFitInch: function (inch) {
                var offsetMM = 2.5;
                var sizePt = getCorrectedTargetPt(inch);
                var offsetPt = offsetMM * 2.834645669;
                var testW = sizePt + offsetPt * 2;
                var maxBin = Math.max(binW, binH);
                return (testW <= maxBin) ? 1 : 0;
            },
            place: function (item, itemGapPt) {
                var currentGap = itemGapPt || gap;
                var size = getItemSize(item);

                var searchW = size.w + currentGap * 2;
                var searchH = size.h + currentGap * 2;

                var best = findBestRect(searchW, searchH);
                if (!best) return false;

                if (best.rotated) {
                    try {
                        item.rotate(90, true, true, true, true, Transformation.CENTER);
                        app.redraw();
                        fastSleep(300);
                    } catch (e) { }

                    size = getItemSize(item);
                    searchW = size.w + currentGap * 2;
                    searchH = size.h + currentGap * 2;

                    best = findBestRect(searchW, searchH);
                    if (!best) return false;
                }

                var targetLeft = best.x + currentGap;
                var targetTop = best.y - currentGap;

                moveItemTopLeftTo(item, targetLeft, targetTop);

                try { app.redraw(); } catch (e) { }

                var b = getArtworkPackBounds(item);
                var placedRect = {
                    x: b[0],
                    y: b[1],
                    w: Math.abs(b[2] - b[0]),
                    h: Math.abs(b[1] - b[3])
                };

                registerUsedRect(placedRect, currentGap);
                return true;
            },
            getUsedRects: function () {
                return usedRects;
            },
            getPackedBounds: function () {
                if (!usedRects || usedRects.length === 0) {
                    return [left - margin, top + margin, right + margin, top - margin];
                }
                var minY = top;
                for (var i = 0; i < usedRects.length; i++) {
                    var bottomY = usedRects[i].y - usedRects[i].h;
                    if (bottomY < minY) minY = bottomY;
                }
                return [left - margin, top + margin, right + margin, minY - margin];
            }
        };
    }

    // =========================================================================
    // 10) QUẢN LÝ FILE (CHUẨN HÓA ĐẶT LẠI TÊN FILE CHỈ ĐỔI SỐ SAU qty_)
    // =========================================================================

    function getFileKey(file) {
        try {
            return file.fsName || file.name;
        } catch (e) {
            return String(file);
        }
    }

    function uniqueAiFile(outFolder, baseName) {
        var f = new File(outFolder.fsName + "/" + baseName + ".ai");
        var n = 2;

        while (f.exists) {
            f = new File(outFolder.fsName + "/" + baseName + " (" + n + ").ai");
            n++;
        }

        return f;
    }

    function makeUniqueLayerName(doc, name) {
        var finalName = name;
        var n = 2;

        while (layerExists(doc, finalName)) {
            finalName = name + " (" + n + ")";
            n++;
        }

        return finalName;
    }

    function layerExists(doc, name) {
        try {
            var l = doc.layers[name];
            return l !== null;
        } catch (e) {
            return false;
        }
    }

    function cleanFileName(name) {
        var s = String(name);
        try {
            s = decodeURI(s);
        } catch (e) { }
        s = s.replace(/%20/g, " ");
        return s;
    }

    function stripExt(name) {
        return String(name).replace(/\.(png|jpg|jpeg|tif|tiff|bmp|psd|ai)(\.(png|jpg|jpeg|tif|tiff|bmp|psd|ai))*$/i, "");
    }

    function getExt(name) {
        var m = String(name).match(/(\.[^\.]+)$/);
        return m ? m[1] : "";
    }

    function trim(s) {
        return String(s).replace(/^\s+|\s+$/g, "");
    }

    function toSizeKey(inch) {
        var n = Number(inch);
        if (isNaN(n)) return String(inch);
        return String(Math.round(n * 1000) / 1000);
    }

    function getErrorMessage(e) {
        if (!e) return "Unknown error";
        if (e.message) return e.message;
        return String(e);
    }

    function getCorrectedTargetPt(inch) {
        var fixedPt = {};
        for (var i = 1; i <= 45; i++) {
            fixedPt[i] = i * 72;
        }
        if (fixedPt[inch]) return fixedPt[inch];
        return inch * 72;
    }

    function queueDoneFileForCurrentSheet(file, info, doneQty, remainQty) {
        var key = getFileKey(file);

        for (var i = 0; i < currentSheetDoneFiles.length; i++) {
            var queued = currentSheetDoneFiles[i];
            if (queued && queued.file && getFileKey(queued.file) === key) {
                return;
            }
        }

        currentSheetDoneFiles.push({
            file: file,
            info: info,
            doneQty: doneQty,
            remainQty: remainQty
        });
    }

    function moveQueuedDoneFiles(doneFolder) {
        if (!doneFolder.exists) doneFolder.create();

        for (var i = 0; i < currentSheetDoneFiles.length; i++) {
            try {
                moveFileToDoneFolder(currentSheetDoneFiles[i], doneFolder);
                processedFileCount++;
            } catch (e) {
                $.writeln("Move done thất bại: " + getErrorMessage(e));
            }
        }

        currentSheetDoneFiles = [];
    }

    function moveFileToDoneFolder(doneItem, doneFolder) {
        var file = doneItem && doneItem.file ? doneItem.file : null;
        if (!file || !file.exists) {
            throw new Error("File nguồn không tồn tại để move sang done");
        }

        var info = doneItem.info;
        var doneQty = Number(doneItem.doneQty);
        var remainQty = Number(doneItem.remainQty);

        if (isNaN(doneQty) || doneQty < 1) {
            throw new Error("doneQty không hợp lệ");
        }

        if (isNaN(remainQty) || remainQty < 0) {
            throw new Error("remainQty không hợp lệ");
        }

        var cleanName = cleanFileName(file.name);
        var ext = getExt(cleanName);
        var doneName = buildFileNameWithQty(info, doneQty, ext);
        var dest = uniqueFileInFolder(doneFolder, doneName);

        var copied = file.copy(dest);
        if (!copied) {
            throw new Error("Không move được file done");
        }

        if (remainQty > 0) {
            renameFileQty(file, info, remainQty);
        } else {
            file.remove();
        }
    }

    function moveFileToErrorFolder(file, errorFolder, reason) {
        try {
            if (!file.exists) return;
            if (!errorFolder.exists) errorFolder.create();
            var cleanName = cleanFileName(file.name);
            var dest = uniqueFileInFolder(errorFolder, cleanName);

            var copied = file.copy(dest);

            if (copied) {
                file.remove();

                try {
                    var baseName = dest.name.replace(/\.[^.]+$/, "");
                    var logFile = new File(errorFolder.fsName + "/" + baseName + "_error.txt");
                    logFile.encoding = "UTF-8";
                    logFile.open("w");
                    var now = new Date();
                    var ts = now.getFullYear() + "-" +
                        pad2(now.getMonth() + 1) + "-" +
                        pad2(now.getDate()) + " " +
                        pad2(now.getHours()) + ":" +
                        pad2(now.getMinutes()) + ":" +
                        pad2(now.getSeconds());
                    logFile.writeln("=== LỖI XỬ LÝ FILE TRANSPARENT ===");
                    logFile.writeln("File     : " + cleanName);
                    logFile.writeln("Thời gian: " + ts);
                    logFile.writeln("Lý do    : " + (reason || "Không xác định"));
                    logFile.close();
                } catch (logErr) {
                    $.writeln("Ghi log lỗi thất bại: " + getErrorMessage(logErr));
                }
            } else {
                throw new Error("Không move được file lỗi");
            }
        } catch (e) {
            $.writeln("Move error thất bại: " + getErrorMessage(e));
        }
    }

    function pushUniqueCurrentSheetId(id) {
        id = String(id);
        for (var i = 0; i < currentSheetIds.length; i++) {
            if (String(currentSheetIds[i]) === id) {
                return;
            }
        }
        currentSheetIds.push(id);
    }

    function uniqueFileInFolder(folder, fileName) {
        var base = stripExt(fileName);
        var ext = getExt(fileName);

        var f = new File(folder.fsName + "/" + fileName);
        var n = 2;

        while (f.exists) {
            f = new File(folder.fsName + "/" + base + " (" + n + ")" + ext);
            n++;
        }

        return f;
    }

    function renameFileQty(file, info, remainQty) {
        try {
            var cleanName = cleanFileName(file.name);
            var ext = getExt(cleanName);

            var newName = buildFileNameWithQty(info, remainQty, ext);

            var target = new File(file.parent.fsName + "/" + newName);
            var n = 2;

            while (target.exists) {
                newName = buildFileNameWithQty(info, remainQty, ext, n);
                target = new File(file.parent.fsName + "/" + newName);
                n++;
            }

            var renamed = file.rename(newName);
            if (renamed) {
                info.base = stripExt(cleanFileName(newName));
                info.qty = remainQty;
            }
        } catch (e) {
            $.writeln("Đổi qty còn lại thất bại: " + getErrorMessage(e));
        }
    }

    function buildFileNameWithQty(info, qty, ext, suffix) {
        var name = "";

        if (info && info.base && /([\-_]?qty[\-_]?)\d+/i.test(info.base)) {
            name = info.base.replace(/([\-_]?qty[\-_]?)\d+(?!.*[\-_]?qty)/i, "$1" + qty);
        } else if (info && info.base) {
            name = info.base + "_qty_" + qty;
        } else {
            name =
                info.id +
                "_transparent-" +
                (info.stt ? info.stt + "-" : "") +
                info.sizeText +
                "_qty_" +
                qty;
        }

        if (suffix && suffix > 1) {
            name += " (" + suffix + ")";
        }

        return name + ext;
    }
})();
