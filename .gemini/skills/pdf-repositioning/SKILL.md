---
name: pdf-repositioning
description: |
  本專案技術指南：如何更新 index.html 中嵌入的加密 PDF (NewData.pdf) 並重新定位所有學生的頁面與座標偏移量。
  本指南包含 RC4 加密腳本、PDF.js 文字座標提取工具以及 index.html 設定檔的更新步驟。
license: Apache-2.0
metadata:
  version: v1
  publisher: local
---

# 嵌入 PDF 與學生座標重新定位工作流

本指南詳細說明如何替換專案主頁面 `index.html` 中的內嵌 PDF，並重新計算與定位學生在 PDF 中對應的頁碼（page）與頂部偏移量（top）。

## 運作原理簡介

1. **密碼保護機制**：
   - 專案中的 PDF 文件並非以明文儲存，而是使用 **RC4 加密** 後，轉換為 Base64 字串儲存在 `index.html` 的 `const encPdfB64 = '...'` 中。
   - 加密與解密所使用的金鑰（Master Key）為：`"PlacementMeetingMasterKey115"`。
2. **定位跳轉機制**：
   - 當使用者點選左側名單中的學生時，系統會查詢 `positions` 物件，取得該學生的 `{ page, top }`。
   - `top` 單位為 **PDF 點數 (PDF Points)**（由上至下的偏移量）。
   - 網頁端會使用 `pdf.js` 渲染各頁面，並根據 `positions` 中的值滾動右側面板，使對應學生的資料正好顯示在視窗中央。

---

## 步驟一：加密新 PDF 並產生 Base64 字串

當有新的 PDF（例如 `NewData.pdf`）需要發布時，必須先對其進行加密。

### 1. 建立加密 Node.js 腳本 `encrypt.js`

在專案目錄下（或臨時工作目錄）建立一個名為 `encrypt.js` 的檔案，內容如下：

```javascript
const fs = require('fs');
const path = require('path');

// RC4 加密/解密演算法
function rc4Encrypt(keyBuffer, dataBuffer) {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  
  // 密鑰排程演算法 (KSA)
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + keyBuffer[i % keyBuffer.length]) % 256;
    const temp = s[i];
    s[i] = s[j];
    s[j] = temp;
  }
  
  // 虛擬隨機生成演算法 (PRGA)
  const result = Buffer.alloc(dataBuffer.length);
  let i = 0;
  j = 0;
  for (let offset = 0; offset < dataBuffer.length; offset++) {
    i = (i + 1) % 256;
    j = (j + s[i]) % 256;
    const temp = s[i];
    s[i] = s[j];
    s[j] = temp;
    const k = s[(s[i] + s[j]) % 256];
    result[offset] = dataBuffer[offset] ^ k;
  }
  return result;
}

// 執行加密
const pdfPath = path.join(__dirname, 'NewData.pdf'); // 欲加密的來源檔案
const key = Buffer.from('PlacementMeetingMasterKey115', 'utf-8');

try {
  const pdfData = fs.readFileSync(pdfPath);
  const encrypted = rc4Encrypt(key, pdfData);
  const base64Str = encrypted.toString('base64');
  
  // 輸出至檔案以利複製，或直接寫入檔案
  fs.writeFileSync(path.join(__dirname, 'enc_output.txt'), base64Str);
  console.log('加密成功！Base64 字串已寫入 enc_output.txt，長度：', base64Str.length);
} catch (err) {
  console.error('加密失敗：', err.message);
}
```

### 2. 執行與替換
- 執行 `node encrypt.js`。
- 開啟產生的 `enc_output.txt`，複製全部字串。
- 用它替換 `index.html` 中的 `const encPdfB64 = '...'` 值（約在第 480 行）。

---

## 步驟二：提取學生的新座標位置 (Positions)

由於新 PDF 的排版與頁數可能與舊版不同，我們需要精確地抓取每位學生姓名在 PDF 中的頁碼（page）和縱向偏移量（top，以 PDF points 為單位）。

### 1. 建立提取器 HTML `extract.html`

在瀏覽器中開啟一個靜態網頁來解析 PDF 文字，建立一個 `extract.html`：

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>PDF 學生座標定位提取器</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  <style>
    body { font-family: system-ui, sans-serif; padding: 30px; line-height: 1.6; max-width: 800px; margin: 0 auto; background: #f7fafc; }
    .card { background: white; padding: 24px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
    pre { background: #1a202c; color: #edf2f7; padding: 15px; border-radius: 5px; overflow-x: auto; font-family: monospace; }
    button { padding: 10px 20px; background: #3182ce; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 1rem; }
    button:hover { background: #2b6cb0; }
    input[type="file"] { margin-bottom: 15px; display: block; }
  </style>
</head>
<body>
  <div class="card">
    <h1>PDF 學生座標提取工具</h1>
    <p>請選擇您的 PDF 檔案（例如 <code>NewData.pdf</code>），此工具會自動掃描包含學生姓名的文字位置，並產生適合的 JSON 座標物件：</p>
    
    <input type="file" id="fileInput" accept=".pdf">
    <button id="extractBtn">開始提取位置</button>
    
    <h3>提取結果 (JSON)：</h3>
    <pre id="output">選擇檔案並點選按鈕後，在此處複製生成的程式碼...</pre>
  </div>

  <script>
    // 指定 PDF.js 的 Worker 來源
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    // 需比對的學生名單，請確保與 index.html 中的名單一致
    const students = [
      { num: '01', name: '洪敬杰' },
      { num: '02', name: '林佳楷' },
      { num: '03', name: '丁冠傑' },
      { num: '04', name: '柳妤蓉' },
      { num: '05', name: '吳柏諭' },
      { num: '06', name: '邱芯琪' },
      { num: '07', name: '邱芯瑜' },
      { num: '08', name: '陳柏叡' },
      { num: '09', name: '洪宇諠' },
      { num: '10', name: '陳俊愷' },
      { num: '11', name: '王宇翔' },
      { num: '12', name: '張宥翔' },
      { num: '13', name: '王宸義' },
      { num: '14', name: '詹喻喬' },
      { num: '15', name: '劉力瑜' },
      { num: '17', name: '黃恩柔' },
      { num: '18', name: '陳鉦元' },
      { num: '19', name: '陳祤祥' },
      { num: '20', name: '陳翊婕' }
    ];

    document.getElementById('extractBtn').addEventListener('click', async () => {
      const fileInput = document.getElementById('fileInput');
      if (fileInput.files.length === 0) {
        alert('請先選擇 PDF 檔案！');
        return;
      }
      
      const file = fileInput.files[0];
      const arrayBuffer = await file.arrayBuffer();
      
      try {
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        const positions = {};
        
        // 初始化所有學生的位置為 null
        students.forEach(s => {
          positions[s.num] = null;
        });

        // 掃描 PDF 的每一頁
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 1.0 });
          const height = viewport.height; // PDF 頁面高度點數
          const textContent = await page.getTextContent();
          
          textContent.items.forEach(item => {
            students.forEach(s => {
              if (item.str.includes(s.name)) {
                // transform[5] 為文字在 PDF 的 Y 座標 (自底部向上算)
                // 轉換為從頂部向下算的偏移量以利跳轉定位
                const topOffset = parseFloat((height - item.transform[5]).toFixed(1));
                positions[s.num] = {
                  page: i,
                  top: topOffset
                };
              }
            });
          });
        }

        document.getElementById('output').textContent = JSON.stringify(positions, null, 2);
      } catch (err) {
        console.error(err);
        alert('解析 PDF 時發生錯誤：' + err.message);
      }
    });
  </script>
</body>
</html>
```

### 2. 執行並獲得 JSON 物件
- 在瀏覽器中開啟 `extract.html`，上傳 `NewData.pdf` 並點擊「開始提取位置」。
- 複製產生的 JSON 物件。如果在 PDF 中找不到某位學生（例如已被移除），其對應的數值會是 `null`（或者直接手動將其從列表中移除）。

---

## 步驟三：更新 index.html 設定

### 1. 更新名單 `students` 陣列
在 `index.html` 的 `const students = [...]` 結構中（約在第 482 行）：
- 比對本次會議名單。若有已不存在的學生（如「學生16 饒禹棠」），直接將其從陣列中刪除。
- 學生序號（num）不需重新編號，保留原本的值，以便與後台/其他配對機制保持同步。

### 2. 更新位置 `positions` 物件
在 `index.html` 的 `const positions = {...}` 結構中（約在第 506 行）：
- 用 `extract.html` 輸出的 JSON 取代原有的物件內容。
- 如果有名單中已不存在的學生，可從 `positions` 物件中一併移除其對應的鍵值對。

---

## 步驟四：驗證與清理

1. **本地開啟驗證**：
   - 開啟 `index.html`，輸入授權密碼。
   - 點選左側名單中的每個學生，確認右邊的 PDF 能自動且精確地滾動至該學生的安置資料位置。
2. **清理暫存檔**：
   - 確保工作流程完成後，刪除暫存產生的 `encrypt.js`、`extract.html`、`enc_output.txt`，以保持程式庫乾淨。
