const fs = require('fs');
const path = require('path');

const picDir = path.join(__dirname, 'PIC');
const outputFile = path.join(__dirname, 'pics-list.js');

// 支援的圖片副檔名
const allowedExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];

console.log('正在掃描 PIC 目錄...');

if (!fs.existsSync(picDir)) {
  console.log('錯誤：未找到 PIC 目錄！正在建立空目錄...');
  fs.mkdirSync(picDir);
}

try {
  const files = fs.readdirSync(picDir);
  const imageFiles = files
    .filter(file => {
      const ext = path.extname(file).toLowerCase();
      return allowedExts.includes(ext);
    })
    .map(file => `  "PIC/${file}"`);

  const fileContent = `// 此檔案由 scan.js 自動生成，或手動更新以管理圖片名單。
// 在本機 (file://) 開啟時，此檔案能繞過 CORS 安全限制載入圖片名單。
window.PIC_IMAGES = [
${imageFiles.join(',\n')}
];
`;

  fs.writeFileSync(outputFile, fileContent, 'utf-8');
  console.log(`掃描完成！共找到 ${imageFiles.length} 張圖片。`);
  console.log(`更新已儲存至：${outputFile}`);
} catch (err) {
  console.error('掃描或寫入檔案時發生錯誤：', err.message);
}
