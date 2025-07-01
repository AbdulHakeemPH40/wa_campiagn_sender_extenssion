/**
 * Script to create a ZIP file of the extension for distribution
 */

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

// Get package version
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const version = packageJson.version;

// Create output directory if it doesn't exist
const outputDir = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Create a file to stream archive data to
const output = fs.createWriteStream(path.join(outputDir, `wa-campaign-sender-v${version}.zip`));
const archive = archiver('zip', {
  zlib: { level: 9 } // Sets the compression level
});

// Listen for all archive data to be written
output.on('close', function() {
  console.log(`Archive created: ${archive.pointer()} total bytes`);
  console.log(`Archive has been finalized and the output file descriptor has closed.`);
  console.log(`ZIP file created at: dist/wa-campaign-sender-v${version}.zip`);
});

// Good practice to catch warnings (ie stat failures and other non-blocking errors)
archive.on('warning', function(err) {
  if (err.code === 'ENOENT') {
    console.warn('Warning:', err);
  } else {
    throw err;
  }
});

// Good practice to catch this error explicitly
archive.on('error', function(err) {
  throw err;
});

// Pipe archive data to the file
archive.pipe(output);

// Files and directories to include in the ZIP
const filesToInclude = [
  'css',
  'docs',
  'fonts',
  'html',
  'icons',
  'images',
  'js',
  'libs',
  'index.js',
  'manifest.json',
  'popup.html',
  'README.md'
];

// Files and directories to exclude
const excludePatterns = [
  '.git',
  'node_modules',
  'dist',
  'scripts',
  '.gitignore',
  'package-lock.json'
];

// Add files to the archive
filesToInclude.forEach(item => {
  const itemPath = path.join(__dirname, '..', item);
  
  if (fs.existsSync(itemPath)) {
    const stats = fs.statSync(itemPath);
    
    if (stats.isDirectory()) {
      // Add directory (and all its contents) to the archive
      archive.directory(itemPath, item);
      console.log(`Added directory: ${item}`);
    } else {
      // Add file to the archive
      archive.file(itemPath, { name: item });
      console.log(`Added file: ${item}`);
    }
  } else {
    console.warn(`Warning: ${item} does not exist and will not be included in the ZIP.`);
  }
});

// Finalize the archive (i.e. we are done appending files)
archive.finalize();