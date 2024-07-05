import * as vscode from 'vscode';
import * as path from "path";
import {Configuration, Project, SolutionFolder, WebProject, WebDeploymentProject} from "./Project";
import {MsBuildProject} from "./MsBuildProject";

/***********
 * TypeScript simplified version of:
 * https://github.com/Microsoft/msbuild/blob/master/src/Build/Construction/Solution/SolutionFile.cs
 */
const vbProjectGuid = "{F184B08F-C81C-45F6-A57F-5ABD9991F28F}";
const csProjectGuid = "{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}";
const cpsProjectGuid = "{13B669BE-BB05-4DDF-9536-439F39A36129}"; //common project system
const cpsCsProjectGuid = "{9A19103F-16F7-4668-BE54-9A1E7A4F7556}"; //common project system
const cpsVbProjectGuid = "{778DAE3C-4631-46EA-AA77-85C1314464D9}"; //common project system
const vjProjectGuid = "{E6FDF86B-F3D1-11D4-8576-0002A516ECE8}";
const vcProjectGuid = "{8BC9CEB8-8B4A-11D0-8D11-00A0C91BC942}";
const fsProjectGuid = "{F2A71F9B-5D33-465A-A702-920D77279786}";
const cpsFsProjectGuid = "{6EC3EE1D-3C4E-46DD-8F32-0CC8E7565705}";
const dbProjectGuid = "{C8D11400-126E-41CD-887F-60BD40844F9E}";
const wdProjectGuid = "{2CFEAB61-6A3B-4EB8-B523-560B4BEEF521}";
const webProjectGuid = "{E24C65DC-7377-472B-9ABA-BC803B73C61A}";
const solutionFolderGuid = "{2150E333-8FDC-42A3-9474-1A3956D46DE8}";

export function createProject(parent: any, basePath : string, m : string[]) : Project {
	const type = m[1];
	const name = m[2];
	const guid = m[4];
	const fullpath = path.join(basePath, m[3].replace(/\\/g, path.sep)).trim();

	switch (m[1]) {
		case vbProjectGuid:
		case csProjectGuid:
		case cpsProjectGuid:
		case cpsCsProjectGuid:
		case cpsVbProjectGuid:
		case fsProjectGuid:
		case cpsFsProjectGuid:
		case dbProjectGuid:
		case vjProjectGuid:
		case vcProjectGuid:			return new MsBuildProject(parent, type, name, fullpath, guid);
		case solutionFolderGuid:	return new SolutionFolder(parent, type, name, fullpath, guid);
		case webProjectGuid:		return new WebProject(parent, type, name, fullpath, guid);
		case wdProjectGuid:			return new WebDeploymentProject(parent, type, name, fullpath, guid);
		default:			        return new Project(parent, type, name, fullpath, guid);
	}
}

class LineParser {
	private _currentLineIndex: number = -1;
	public constructor(private lines: string[]) {}

	public currentLine(): string {
		return this.lines[this._currentLineIndex].trim();
	}
	public readLine(): string | null {
		if (this._currentLineIndex + 1 >= this.lines.length)
			return null;
		return this.lines[++this._currentLineIndex].trim();
	}
	public parseSection(end : string, func : (str: string) => void): void {
		let str: string | null;
		while ((str = this.readLine()) !== null && str !== end)
			func(str);
	}
	public parseSection_re(end: string, re: RegExp, func: (m: RegExpExecArray | null) => void): void {
		let str: string | null;
		while ((str = this.readLine()) !== null && str !== end)
			func(re.exec(str));
		//this.parseSection(end, str => func(re.exec(str)));
	}
}

export class Solution {
	public projects:{ [id: string] : Project; } = {};
	public configurations: Configuration[] = [];
	public currentVisualStudioVersion: string = "";
	public activeConfiguration = new Configuration("Debug", "Win32");

	private constructor(public readonly path: string, public readonly version: string) {
	}

	public static async read(path: string) : Promise<Solution | undefined> {
		const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(path));
		const content = new TextDecoder().decode(bytes);
		const parser = new LineParser(content.split('\n'));

		const slnFileHeaderNoVersion: string = "Microsoft Visual Studio Solution File, Format Version ";
		for (let i = 0; i < 2; i++) {
			const str = parser.readLine();
			if (str && str.startsWith(slnFileHeaderNoVersion)) {
				const solution = new Solution(path, str.substring(slnFileHeaderNoVersion.length));
				solution.parseSolution(parser);
				return solution;
			}
		}
	}

	private parseSolution(parser : LineParser): void {
		let str: string | null;
		const rawProjectConfigurationsEntries: { [id: string]: string } = {};
		const basePath = path.dirname(this.path);

		while ((str = parser.readLine()) !== null) {
			if (str.startsWith("Project(")) {
				// Extract the important information from the first line.
				const projectRegEx = /Project\("(.*)"\)\s*=\s*"(.*)"\s*,\s*"(.*)"\s*,\s*"(.*)"/;
				const m = projectRegEx.exec(str)?.map(r => r.trim());

				if (m && m.length >= 5) {
					const proj = createProject(this, basePath, m);
					this.projects[proj.guid] = proj;

					parser.parseSection("EndProject", line => {
						if (line.startsWith("ProjectSection(SolutionItems)")) {
							parser.parseSection_re("EndProjectSection", /(.*)\s*=\s*(.*)/, m => {
								if (m && m.length >= 3)
									proj.addFile(path.basename(m[1].replace(/\\/, path.sep).trim()), path.join(basePath, m[2].replace(/\\/, path.sep).trim()));
							});

						} else if (line.startsWith("ProjectSection(ProjectDependencies)")) {
							// We have a ProjectDependencies section.  Each subsequent line should identify a dependency
							parser.parseSection_re("EndProjectSection", /(.*)\s*=\s*(.*)/, m => {
								if (m && m.length >= 2) {
									proj.addDependency(this.projects[m[1].trim()]);
								}
							});

						} else if (line.startsWith("ProjectSection(WebsiteProperties)")) {
							//This section is present only in Venus projects, and contains properties that we'll need in order to call the AspNetCompiler task
							parser.parseSection_re("EndProjectSection", /(.*)\s*=\s*(.*)/, m => {
								if (m && m.length >= 3)
									proj.addWebProperty(m[1].trim(), m[2].trim());
							});
						}
					});
				}

			} else if (str.startsWith("GlobalSection(NestedProjects)")) {
				parser.parseSection_re("EndGlobalSection", /(.*)\s*=\s*(.*)/, m => {
					if (m && m.length >= 3) {
						const proj = this.projects[m[1].trim()];
						const parent = this.projects[m[2].trim()];
						if (proj && parent)
							parent.addChildProject(proj);
					}
				});

			} else if (str.startsWith("GlobalSection(SolutionConfigurationPlatforms)")) {
				parser.parseSection("EndGlobalSection", str => {
					const names	= str.split('=');
					const full_name = names[0].trim();
					if (full_name !== "DESCRIPTION")
						this.configurations.push(Configuration.make(full_name));
				});

			} else if (str.startsWith("GlobalSection(ProjectConfigurationPlatforms)")) {
				parser.parseSection("EndGlobalSection", str => {
					const names: string[] = str.split('=');
					rawProjectConfigurationsEntries[names[0].trim()] = names[1].trim();
				});

			} else if (str.startsWith("VisualStudioVersion")) {
				const words: string[] = str.split('=');
				this.currentVisualStudioVersion = words[1].trim();
			}
			// No other section types to process at this point, so just ignore the line and continue.
		}

		// Instead of parsing the data line by line, we parse it project by project, constructing the entry name (e.g. "{A6F99D27-47B9-4EA4-BFC9-25157CBDC281}.Release|Any CPU.ActiveCfg") and retrieving its value from the raw data.
        // The reason for this is that the IDE does it this way, and as the result the '.' character is allowed in configuration names although it technically separates different parts of the entry name string.
        // This could lead to ambiguous results if we tried to parse the entry name instead of constructing it and looking it up.
        // Although it's pretty unlikely that this would ever be a problem, it's safer to do it the same way VS IDE does it.
		for (const key in this.projects) {
			const project = this.projects[key];
            for (const configuration of this.configurations) {
                // The "ActiveCfg" entry defines the active project configuration in the given solution configuration
                // This entry must be present for every possible solution configuration/project combination.
                const config = rawProjectConfigurationsEntries[project.guid + "." + configuration.fullName + ".ActiveCfg"];
                if (config) {
                    // The "Build.0" entry tells us whether to build the project configuration in the given solution configuration
                    // Technically, it specifies a configuration name of its own which seems to be a remnant of an initial, more flexible design of solution configurations (as well as the '.0' suffix - no higher values are ever used)
                    // The configuration name is not used, and the whole entry means "build the project configuration" if it's present in the solution file, and "don't build" if it's not
                    const config2 = rawProjectConfigurationsEntries[project.guid + "." + configuration.fullName + ".Build.0"];
                    project.setProjectConfiguration(configuration.fullName, Configuration.make(config), !!config2);
                }
            }
        }
	}
}
