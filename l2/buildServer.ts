/// <mls shortName="buildServer" project="102021" enhancement="_blank" />

import { IJSONDependence } from '/_100554_/l2/libCompile.js';
import { createStorFile, IReqCreateStorFile } from '/_100554_/l2/collabLibStor.js';

let esBuild: any;
export const DISTFOLDER = 'wwwroot';

export async function build(info: InfoBuild): Promise<string> {
    try {
        await loadEsbuild();
        const ret = await buildServer(info);
        return ret

    } catch (e: any) {
        console.info('[buildServer]:' + e.message)
        return '[buildServer]: Erro to build'
    }

}

export async function loadEsbuild() {
    if ((mls as any).esbuild) {
        esBuild = (mls as any).esbuild;
    } else if (!(mls as any).esbuildInLoad) await initializeEsBuild();
}

async function initializeEsBuild() {

    (mls as any).esbuildInLoad = true;
    const url = 'https://unpkg.com/esbuild-wasm@0.14.54/esm/browser.min.js';
    if (!esBuild) {
        esBuild = await import(url);
        await esBuild.initialize({
            wasmURL: "https://unpkg.com/esbuild-wasm@0.14.54/esbuild.wasm"
        });
        (mls as any).esbuild = esBuild;
        (mls as any).esbuildInLoad = false

    }
}

async function buildServer(info: InfoBuild): Promise<string> {

    const key = mls.stor.getKeyToFiles(info.project, 1, info.shortName, info.folder, '.ts');
    if (!mls.stor.files[key]) throw new Error('[buildServer]: Not found stor');

    const actualFile = mls.stor.files[key];

    let name = `/_${actualFile.project}_${actualFile.shortName}`;
    if (actualFile.folder) name = `/_${actualFile.project}_${actualFile.folder}/${actualFile.shortName}`;

    const ret = {
        errors: [] as any,
        importsJs: ["/_100554_collabConsoleL1", name],
        importsMap: ['"lit": "https://cdn.jsdelivr.net/gh/lit/dist@3/all/lit-all.min.js"', '"lit/decorators.js": "https://cdn.jsdelivr.net/npm/lit@3.0.0/decorators/+esm"']
    } as IJSONDependence

    const bundle = await compileWithEsbuild(ret, actualFile);

    if (!bundle) throw new Error(`[buildServer]: Build returned empty result`);
    return bundle

}

async function compileWithEsbuild(info: IJSONDependence, storFile: mls.stor.IFileInfo): Promise<string | null> {
    try {

        if (!esBuild) {
            console.warn("[buildServer]: esbuild not loaded");
            return null;
        }

        const storDist = getDistStorFile(storFile.project);
        let needCompile = !storDist;

        const virtualFiles: Record<string, string> = await getVirtualFiles(storFile);

        let entryCode = Object.keys(mls.stor.files).map((p, i) => {

            const sf = mls.stor.files[p];
            if (!sf || sf.level !== 1 || sf.extension != '.ts' || sf.project !== storFile.project) return '';
            
            if (storDist && (!storDist.updatedAt || new Date(sf.updatedAt || '') > new Date(storDist.updatedAt || ''))) needCompile = true;
            
            const verify = `/_${sf.project}_${sf.folder ? sf.folder + '/' : ''}${sf.shortName}`;
            const name = './' + (sf.folder ? sf.folder + '/' : '') + sf.shortName + '.js';

            const aux = info.importsJs.includes(verify) ? `Object.assign(window, m${i});` : '';

            return `import * as m${i} from "${name}";
                ${aux} 
                `

        }).join("\n").trim();

        console.info(needCompile)
        if (!needCompile) return await storDist.getContent() as string;

        const result = await esBuild.build({
            stdin: {
                contents: entryCode,
                sourcefile: "virtual-entry.ts",
                resolveDir: "/",
            },
            bundle: true,
            write: false,
            format: "esm",
            loader: { ".ts": "ts" },
            minify: true,
            plugins: [getVirtualFilesPlugin(virtualFiles)]
        });

        if (!result.outputFiles || !result.outputFiles[0]) return null;

        await generateOutput(storFile.project, result.outputFiles[0].text);

        return result.outputFiles[0].text;

    } catch (err) {
        console.error("esbuild error:", err);
        return null;
    }
}

async function getVirtualFiles(storFile: mls.stor.IFileInfo): Promise<Record<string, string>> {

    let files: Record<string, string> = {};

    for (const [name, f] of Object.entries(mls.stor.files)) {

        if (!f || f.project !== storFile.project || f.level !== 1 || f.extension !== '.ts') continue;

        const name = ((f.folder ? f.folder + '/' + f.shortName : f.shortName) + '.js').toLocaleLowerCase();

        if (files[name]) continue;

        files[name] = await f.getContent() as string;

    }

    return files;

}

function getVirtualFilesPlugin(files: Record<string, string>) {
    return {
        name: "virtual-files",
        setup(build: any) {
            // Resolver imports relativos
            build.onResolve({ filter: /^(\.|\/)/ }, (args: any) => {

                if (args.importer.split('/').length >= 3) {

                    const importer = args.importer;
                    const base = "file://" + importer;
                    const resolvedURL = new URL(args.path, base);
                    let resolved = resolvedURL.pathname;

                    // adiciona extensão se faltar
                    if (!resolved.endsWith(".ts") && !resolved.endsWith(".js")) {
                        resolved += ".js";
                    }

                    return {
                        path: resolved,
                        namespace: "vfs",
                    };
                } else {

                    const resolved = new URL(args.path, "file://" + args.resolveDir + "/").pathname;
                    return { path: resolved.endsWith(".ts") || resolved.endsWith(".js") ? resolved : resolved + ".js", namespace: "vfs" };
                }
            });

            // Retornar conteúdo dos arquivos da memória
            build.onLoad({ filter: /\.(ts|js)$/, namespace: "vfs" }, (args: any) => {
                const path = (args.path.replace(/^\/+/, "").trim()).toLocaleLowerCase(); // remove /
                const content = files[path];
                if (!content) {
                    console.warn("Arquivo não encontrado no virtual FS:", path);
                    return { contents: "", loader: "ts" };
                }
                return { contents: content, loader: "ts" };
            });
        }
    };
}

async function generateOutput(project: number, srcBuild: string) {

    const newDistFolder = `${DISTFOLDER}`;
    let storFilesDist = getDistStorFile(project);
    if (!storFilesDist) storFilesDist = await createStorFileOutput({ project, shortName: 'serverRunTime', folder: newDistFolder, ext: '.js' }, srcBuild);
    else await mls.stor.localStor.setContent(storFilesDist, { contentType: 'string', content: srcBuild });
    //storFilesDist.updatedAt = new Date().toISOString();

}

function getDistStorFile(project: number) {
    const newDistFolder = `${DISTFOLDER}`;
    const keyToDistJs = mls.stor.getKeyToFiles(project, 1, 'serverRunTime', newDistFolder, '.js');
    let storFileDistJs = mls.stor.files[keyToDistJs];
    return storFileDistJs

}

async function createStorFileOutput(data: { project: number, shortName: string, folder: string, ext: string }, source: string) {
    const param: IReqCreateStorFile = {
        project: data.project,
        shortName: data.shortName,
        folder: data.folder,
        level: 1,
        extension: data.ext,
        source,
        status: 'new'
    }
    const storFile = await createStorFile(param, false, false, false);
    return storFile;
}

export interface InfoBuild {
    project: number,
    shortName: string,
    folder: string,
}