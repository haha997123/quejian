import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const app=await fs.readFile(path.join(root,'ui','app.js'),'utf8');
const importPattern=/^import\s*\{([^}]+)\}\s*from\s*(['"])\.\/([a-zA-Z0-9_-]+\.js)\2\s*;?\s*$/gm;
const imports=[...app.matchAll(importPattern)];
let bundle='';
for(const [,bindings,,name] of imports){
 const names=bindings.split(',').map(binding=>binding.trim()).filter(Boolean);
 if(names.some(binding=>!/^\w+(?:\s+as\s+\w+)?$/.test(binding))) throw new Error(`Unsupported module binding in ${name}.`);
 const exports=names.map(binding=>binding.split(/\s+as\s+/)[0]);
 const locals=names.map(binding=>binding.replace(/\s+as\s+/,':'));
 const code=(await fs.readFile(path.join(root,'ui',name),'utf8')).replace(/\bexport\s+(?=(?:function|const|let|class)\b)/g,'');
 if(/^\s*(?:import|export)\s/m.test(code)) throw new Error(`Unsupported module syntax in ${name}.`);
 bundle+=`const {${locals.join(',')}} = (()=>{\n${code}\nreturn {${exports.join(',')}};\n})();\n`;
}
const appBody=app.replace(importPattern,'');
if(/^\s*import\s/m.test(appBody)) throw new Error('Unsupported app import syntax.');
bundle+=appBody;
let css=await fs.readFile(path.join(root,'ui','styles.css'),'utf8');
// Ship the painted lounge inside app.html. The packaged UI never needs a
// filesystem URL, a local web server, or a remote image request.
const localAssets=[...new Set([...css.matchAll(/url\(\s*(['"]?)(\.\.\/assets\/[^'"\s)]+)\1\s*\)/g)].map(match=>match[2]))];
for(const reference of localAssets){
 const filename=path.resolve(root,'ui',reference);
 const assetRoot=path.join(root,'assets')+path.sep;
 if(!filename.startsWith(assetRoot)) throw new Error(`UI asset is outside assets/: ${reference}`);
 const extension=path.extname(filename).toLowerCase();
 const mime={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'}[extension];
 if(!mime) throw new Error(`Unsupported UI asset: ${reference}`);
 const data=await fs.readFile(filename);
 css=css.split(reference).join(`data:${mime};base64,${data.toString('base64')}`);
}
for(const match of css.matchAll(/url\(\s*(?:(["'])(.*?)\1|([^)]*))\s*\)/g)){
 const url=(match[2]??match[3]).trim();
 if(!url.startsWith('data:')&&!url.startsWith('#')) throw new Error('Desktop CSS contains a non-bundled image or font URL.');
}
let html=await fs.readFile(path.join(root,'ui','index.html'),'utf8');
html=html.replace(/<link[^>]+href=["']styles\.css["'][^>]*>/,()=>`<style>${css}</style>`)
 .replace(/<script[^>]+src=["']app\.js["'][^>]*><\/script>/,()=>`<script>\n${bundle.replace(/<\/script/gi,'<\\/script')}\n</script>`);
if(/<script[^>]+src=|<link[^>]+rel=["']stylesheet|<(?:img|source)[^>]+src=["'](?!data:)/i.test(html)) throw new Error('Desktop UI must be self-contained.');
await fs.mkdir(path.join(root,'assets'),{recursive:true});
await fs.writeFile(path.join(root,'assets','app.html'),html,'utf8');
await fs.writeFile(path.join(root,'bundle-check.js'),bundle,'utf8');
console.log('Desktop UI bundled.');
