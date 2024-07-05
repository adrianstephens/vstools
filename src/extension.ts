// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from "path";
import {Solution} from "./Solution";
import {SolutionExplorerProvider, ProjectDir, SolutionDir} from "./view";

export async function searchFilesInDir(startPath:string, extension: string, recursive: boolean = false) : Promise<string[]> {
	const uri = vscode.Uri.file(startPath);
    const items = await vscode.workspace.fs.readDirectory(uri);
    let result: string[] = [];

	for (const i of items) {
		if (i[1] === vscode.FileType.File) {
			if (i[0].endsWith(extension)) {
				result.push(path.join(startPath, i[0]));
			}
		} else if (i[1] === vscode.FileType.Directory && recursive) {
			const subresult = await searchFilesInDir(path.join(startPath, i[0]), extension, recursive);
			result = result.concat(subresult);
		}
    }

    return result;
}
function registerCommand(context: vscode.ExtensionContext, command: string, callback: (...args: any[]) => any, thisArg?: any) {
	const disposable = vscode.commands.registerCommand(command, callback);
	context.subscriptions.push(disposable);
}

export function activate(context: vscode.ExtensionContext) {
	const paths = vscode.workspace.workspaceFolders?.map(w => w.uri.fsPath) || [];

	async function findSolution() {
		const slns = await vscode.workspace.findFiles('*.sln');
		if (slns.length === 1) {
			Solution.read(slns[0].fsPath).then(solution => {
				if (solution) {
					vscode.commands.executeCommand('setContext', 'loadedFlag', true);
					new SolutionExplorerProvider(solution);
				}
			});
		}
	}

	findSolution();


	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json

	registerCommand(context, 'vstools.solutionDir', SolutionDir);
	registerCommand(context, 'vstools.projectDir', ProjectDir);

	registerCommand(context, 'vstools.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World!');
	});

	registerCommand(context, 'vstools.buildProject', (item) => {
		vscode.window.showInformationMessage('Build me!');
		item.build();
	});

	registerCommand(context, 'vstools.deleteEntry', () => {
		vscode.window.showInformationMessage('Delete me!');
	});
}
