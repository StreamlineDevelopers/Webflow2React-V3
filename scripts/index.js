import fs from 'fs-extra';
import path from 'path';
import { parseDocument } from 'htmlparser2';
import { fileURLToPath } from 'url';

// --- Configuration ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const config = fs.readJsonSync(path.join(__dirname, '../config.json'));

function cleanNode(node) {
    if (Array.isArray(node)) {
        return node.map(cleanNode);
    }
    if (typeof node === "object" && node !== null) {
        // eslint-disable-next-line no-unused-vars
        const { parent, prev, next, startIndex, endIndex, ...rest } = node;
        const newNode = { ...rest };
        if (newNode.children) {
            newNode.children = cleanNode(newNode.children);
        }
        return newNode;
    }
    return node;
}

async function processHtmlFiles(inputHtmlDir, outputAstDir) {
    await fs.ensureDir(outputAstDir);
    const htmlFiles = await fs.readdir(inputHtmlDir);

    for (const htmlFile of htmlFiles) {
        if (path.extname(htmlFile).toLowerCase() === '.html') {
            const htmlFilePath = path.join(inputHtmlDir, htmlFile);
            const baseName = path.basename(htmlFile, '.html');
            console.log(`Processing ${htmlFile}...`);

            const htmlContent = await fs.readFile(htmlFilePath, "utf-8");
            const dom = parseDocument(htmlContent);
            const cleanedAST = cleanNode(dom);

            const astFilePath = path.join(outputAstDir, `${baseName}_ast.json`);
            await fs.writeJson(astFilePath, cleanedAST, { spaces: 2 });
            console.log(`AST written to ${astFilePath}`);
        }
    }
}

// --- Main execution ---
const inputHtmlDirectory = path.join(__dirname, config.paths.htmlInput);
const outputAstDirectory = path.join(__dirname, config.paths.asts);

processHtmlFiles(inputHtmlDirectory, outputAstDirectory)
    .then(() => console.log('All HTML files processed into ASTs.'))
    .catch(console.error);