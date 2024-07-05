import * as vscode from 'vscode';
import * as path from "path";

export function globMatch(pattern: string, input: string): RegExpMatchArray | null {
    if (!isGlobPattern(pattern))
        return input.match(pattern);

    const regExp = toRegExp(pattern);
    return regExp.exec(input);
}

export function globTest(pattern: string | string[], input: string): boolean {
    if (typeof pattern === "string")
        pattern = [pattern];
    
    for (const p of pattern) {
        if (isGlobPattern(p)) {
            if (toRegExp(p).exec(input))
                return true;
        } else if (input.endsWith(p)) {
            return true;
        }
    }

   return false;
}
export function globTest2(basePath: string, pattern: string, input: string): boolean {
    return globTest(pattern.split(';').map(s => path.join(basePath, s)), input);
}

export async function globFileSearch(basePath: string, pattern: string, exclude?:string | string[]): Promise<string[]> {
    const result: string[] = [];

    if (!isGlobPattern(pattern))
        return [ path.join(basePath, pattern) ];

    try {
        const items = await vscode.workspace.fs.readDirectory(vscode.Uri.file(basePath));
        for (const i of items) {
            const filename = path.join(basePath, i[0]);
            if (exclude && globTest(exclude, filename))
                continue;

            if (globTest(pattern, filename))
                result.push(filename);

            if (i[1] == vscode.FileType.Directory) {
                const subresult = await globFileSearch(filename, pattern, exclude);
                result.push(...subresult);
            }
        }
    } catch (e) {
        // Ignore
    }

    return result;
}

export function isGlobPattern(pattern: string): boolean {
    return pattern.indexOf("*") >= 0
        || pattern.indexOf("?") >= 0
        || pattern.indexOf("[") >= 0
        || pattern.indexOf("{") >= 0;
}

function toRegExp(globPattern: string): RegExp {
    let regExpString = "", isRange = false, isBlock = false;
    for (let i = 0; i < globPattern.length; i++) {
        const c = globPattern[i];
        if ([".", "/", "\\", "$", "^"].indexOf(c) !== -1) {
            regExpString += "\\" + c;
        } else if (c === "?") {
            regExpString += ".";
        } else if (c === "[") {
            isRange = true;
            regExpString += "[";
        } else if (c === "]") {
            isRange = false;
            regExpString += "]";
        } else if (c === "!") {
            regExpString += isRange ? "^" : "!";
        } else if (c === "{") {
            isBlock = true;
            regExpString += "(";
        } else if (c === "}") {
            isBlock = false;
            regExpString += ")";
        } else if (c === ",") {
            regExpString += isBlock ? "|" : "\\,";
        } else if (c === "*") {
            if (globPattern[i + 1] === "*") {
                regExpString += ".*";
                i++;
                if (globPattern[i + 1] === "/" || globPattern[i + 1] === "\\")
                    i++;
            } else {
                regExpString += "[^/]*";
            }
        } else {
            regExpString += c;
        }
    }
    return new RegExp(regExpString);
}
