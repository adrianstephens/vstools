import * as vscode from 'vscode';
import * as path from "path";
import * as binary from "./binary";
import {Uri} from 'vscode';
import {Configuration, Project, SolutionFolder, WebProject, WebDeploymentProject} from "./Project";
import {MsBuildProject, CPSProject} from "./MsBuildProject";
import {CompDocHeader, CompDocReader} from "./CompoundDocument";
import {Extension} from './extension';

/***********
 * TypeScript simplified version of:
 * https://github.com/Microsoft/msbuild/blob/master/src/Build/Construction/Solution/SolutionFile.cs
 */

const known_guids : Record<string, any> = {
/*Web Site*/										"{E24C65DC-7377-472B-9ABA-BC803B73C61A}": {make: WebProject, 		icon:""},
/*Solution Folder*/									"{2150E333-8FDC-42A3-9474-1A3956D46DE8}": {make: SolutionFolder, 	icon:""},
/*wdProjectGuid*/ 									"{2CFEAB61-6A3B-4EB8-B523-560B4BEEF521}": {make: WebDeploymentProject, icon:""},

/*CPS*/ 											"{13B669BE-BB05-4DDF-9536-439F39A36129}": {make: CPSProject, 		icon:""},
/*ASP.NET 5*/									  	"{8BB2217D-0F2D-49D1-97BC-3654ED321F3B}": {make: MsBuildProject, 	icon:""},
/*ASP.NET Core Empty*/							 	"{356CAE8B-CFD3-4221-B0A8-081A261C0C10}": {make: MsBuildProject, 	icon:""},
/*ASP.NET Core Web API*/						   	"{687AD6DE-2DF8-4B75-A007-DEF66CD68131}": {make: MsBuildProject, 	icon:""},
/*ASP.NET Core Web App*/						   	"{E27D8B1D-37A3-4EFC-AFAE-77744ED86BCA}": {make: MsBuildProject, 	icon:""},
/*ASP.NET Core Web App (Model-View-Controller)*/	"{065C0379-B32B-4E17-B529-0A722277FE2D}": {make: MsBuildProject, 	icon:""},
/*ASP.NET Core with Angular*/					  	"{32F807D6-6071-4239-8605-A9B2205AAD60}": {make: MsBuildProject, 	icon:""},
/*ASP.NET Core with React.js*/					 	"{4C3A4DF3-0AAD-4113-8201-4EEEA5A70EED}": {make: MsBuildProject, 	icon:""},
/*ASP.NET MVC 1*/								  	"{603C0E0B-DB56-11DC-BE95-000D561079B0}": {make: MsBuildProject, 	icon:""},
/*ASP.NET MVC 2*/								  	"{F85E285D-A4E0-4152-9332-AB1D724D3325}": {make: MsBuildProject, 	icon:""},
/*ASP.NET MVC 3*/								  	"{E53F8FEA-EAE0-44A6-8774-FFD645390401}": {make: MsBuildProject, 	icon:""},
/*ASP.NET MVC 4*/								  	"{E3E379DF-F4C6-4180-9B81-6769533ABE47}": {make: MsBuildProject, 	icon:""},
/*ASP.NET MVC 5 / Web Application*/					"{349C5851-65DF-11DA-9384-00065B846F21}": {make: MsBuildProject, 	icon:""},
/*Azure Functions*/									"{30E03E5A-5F87-4398-9D0D-FEB397AFC92D}": {make: MsBuildProject, 	icon:""},
/*Azure Resource Group (Blank Template)*/		  	"{14B7E1DC-C58C-427C-9728-EED16291B2DA}": {make: MsBuildProject, 	icon:""},
/*Azure Resource Group (Web app)*/				 	"{E2FF0EA2-4842-46E0-A434-C62C75BAEC67}": {make: MsBuildProject, 	icon:""},
/*Azure WebJob (.NET Framework)*/				  	"{BFBC8063-F137-4FC6-AEB4-F96101BA5C8A}": {make: MsBuildProject, 	icon:""},
/*Blazor Server App*/							  	"{C8A4CD56-20F4-440B-8375-78386A4431B9}": {make: MsBuildProject, 	icon:""},
/*C#*/											 	"{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}": {make: MsBuildProject, 	icon:"CSProjectNode"},
/*C# (.Net Core)*/								 	"{9A19103F-16F7-4668-BE54-9A1E7A4F7556}": {make: CPSProject, 		icon:"CSProjectNode"},
/*C++*/												"{8BC9CEB8-8B4A-11D0-8D11-00A0C91BC942}": {make: MsBuildProject, 	icon:"CPPProjectNode"},
/*Class Library*/								  	"{2EFF6E4D-FF75-4ADF-A9BE-74BEC0B0AFF8}": {make: MsBuildProject, 	icon:""},
/*Console App*/										"{008A663C-3F22-40EF-81B0-012B6C27E2FB}": {make: MsBuildProject, 	icon:""},
/*Database*/ 										"{C8D11400-126E-41CD-887F-60BD40844F9E}": {make: MsBuildProject, 	icon:""},
/*Database*/									   	"{A9ACE9BB-CECE-4E62-9AA4-C7E7C5BD2124}": {make: MsBuildProject, 	icon:""},
/*Database (other project types)*/				 	"{4F174C21-8C12-11D0-8340-0000F80270F8}": {make: MsBuildProject, 	icon:""},
/*Deployment Cab*/								 	"{3EA9E505-35AC-4774-B492-AD1749C4943A}": {make: MsBuildProject, 	icon:""},
/*Deployment Merge Module*/							"{06A35CCD-C46D-44D5-987B-CF40FF872267}": {make: MsBuildProject, 	icon:""},
/*Deployment Setup*/							   	"{978C614F-708E-4E1A-B201-565925725DBA}": {make: MsBuildProject, 	icon:""},
/*Deployment Smart Device Cab*/						"{AB322303-2255-48EF-A496-5904EB18DA55}": {make: MsBuildProject, 	icon:""},
/*Distributed System*/							 	"{F135691A-BF7E-435D-8960-F99683D2D49C}": {make: MsBuildProject, 	icon:""},
/*Dynamics 2012 AX C# in AOT*/					 	"{BF6F8E12-879D-49E7-ADF0-5503146B24B8}": {make: MsBuildProject, 	icon:""},
/*Extensibility*/								  	"{82B43B9B-A64C-4715-B499-D71E9CA2BD60}": {make: MsBuildProject, 	icon:""},
/*F#*/											 	"{F2A71F9B-5D33-465A-A702-920D77279786}": {make: MsBuildProject, 	icon:"FSProjectNode"},
/*F# (CPS)*/ 										"{6EC3EE1D-3C4E-46DD-8F32-0CC8E7565705}": {make: CPSProject, 		icon:"FSProjectNode"},
/*J#*/											 	"{E6FDF86B-F3D1-11D4-8576-0002A516ECE8}": {make: MsBuildProject, 	icon:"JSProjectNode"},
/*JScript*/											"{262852C6-CD72-467D-83FE-5EEB1973A190}": {make: MsBuildProject, 	icon:""},
/*Legacy (2003) Smart Device (C#)*/					"{20D4826A-C6FA-45DB-90F4-C717570B9F32}": {make: MsBuildProject, 	icon:""},
/*Legacy (2003) Smart Device (VB.NET)*/				"{CB4CE8C6-1BDB-4DC7-A4D3-65A1999772F8}": {make: MsBuildProject, 	icon:""},
/*LightSwitch*/										"{8BB0C5E8-0616-4F60-8E55-A43933E57E9C}": {make: MsBuildProject, 	icon:""},
/*Lightswitch*/										"{DA98106F-DEFA-4A62-8804-0BD2F166A45D}": {make: MsBuildProject, 	icon:""},
/*LightSwitch Project*/								"{581633EB-B896-402F-8E60-36F3DA191C85}": {make: MsBuildProject, 	icon:""},
/*Micro Framework*/									"{B69E3092-B931-443C-ABE7-7E7b65f2A37F}": {make: MsBuildProject, 	icon:""},
/*Mono for Android / Xamarin.Android*/				"{EFBA0AD7-5A72-4C68-AF49-83D382785DCF}": {make: MsBuildProject, 	icon:""},
/*MonoDevelop Addin*/							  	"{86F6BF2A-E449-4B3E-813B-9ACC37E5545F}": {make: MsBuildProject, 	icon:""},
/*MonoTouch  Xamarin.iOS*/							"{6BC8ED88-2882-458C-8E55-DFD12B67127B}": {make: MsBuildProject, 	icon:""},
/*MonoTouch Binding*/							  	"{F5B4F3BC-B597-4E2B-B552-EF5D8A32436F}": {make: MsBuildProject, 	icon:""},
/*Office/SharePoint App*/						  	"{C1CDDADD-2546-481F-9697-4EA41081F2FC}": {make: MsBuildProject, 	icon:""},
/*Platform Toolset v120*/						  	"{8DB26A54-E6C6-494F-9B32-ACBB256CD3A5}": {make: MsBuildProject, 	icon:""},
/*Platform Toolset v141*/						  	"{C2CAFE0E-DCE1-4D03-BBF6-18283CF86E48}": {make: MsBuildProject, 	icon:""},
/*Portable Class Library*/						 	"{786C830F-07A1-408B-BD7F-6EE04809D6DB}": {make: MsBuildProject, 	icon:""},
/*PowerShell*/									 	"{F5034706-568F-408A-B7B3-4D38C6DB8A32}": {make: MsBuildProject, 	icon:""},
/*Project Folders*/									"{66A26720-8FB5-11D2-AA7E-00C04F688DDE}": {make: MsBuildProject, 	icon:""},
/*Python*/										 	"{888888A0-9F3D-457C-B088-3A5042F75D52}": {make: MsBuildProject, 	icon:""},
/*SharePoint (C#)*/									"{593B0543-81F6-4436-BA1E-4747859CAAE2}": {make: MsBuildProject, 	icon:""},
/*SharePoint (VB.NET)*/								"{EC05E597-79D4-47F3-ADA0-324C4F7C7484}": {make: MsBuildProject, 	icon:""},
/*SharePoint Workflow*/								"{F8810EC1-6754-47FC-A15F-DFABD2E3FA90}": {make: MsBuildProject, 	icon:""},
/*Silverlight*/										"{A1591282-1198-4647-A2B1-27E5FF5F6F3B}": {make: MsBuildProject, 	icon:""},
/*Smart Device (C#)*/							  	"{4D628B5B-2FBC-4AA6-8C16-197242AEB884}": {make: MsBuildProject, 	icon:""},
/*Smart Device (VB.NET)*/						  	"{68B1623D-7FB9-47D8-8664-7ECEA3297D4F}": {make: MsBuildProject, 	icon:""},
/*SSIS*/										   	"{159641D6-6404-4A2A-AE62-294DE0FE8301}": {make: MsBuildProject, 	icon:""},
/*SSIS*/										   	"{D183A3D8-5FD8-494B-B014-37F57B35E655}": {make: MsBuildProject, 	icon:""},
/*SSIS*/										   	"{C9674DCB-5085-4A16-B785-4C70DD1589BD}": {make: MsBuildProject, 	icon:""},
/*SSRS*/										   	"{F14B399A-7131-4C87-9E4B-1186C45EF12D}": {make: MsBuildProject, 	icon:""},
/*Shared Project*/								 	"{D954291E-2A0B-460D-934E-DC6B0785DB48}": {make: MsBuildProject, 	icon:""},
/*Test*/										   	"{3AC096D0-A1C2-E12C-1390-A8335801FDAB}": {make: MsBuildProject, 	icon:""},
/*Universal Windows Class Library (UWP)*/		  	"{A5A43C5B-DE2A-4C0C-9213-0A381AF9435A}": {make: MsBuildProject, 	icon:""},
/*VB.NET*/										 	"{F184B08F-C81C-45F6-A57F-5ABD9991F28F}": {make: MsBuildProject, 	icon:""},
/*VB.NET (CPS)*/								 	"{778DAE3C-4631-46EA-AA77-85C1314464D9}": {make: CPSProject, 		icon:""},
/*Visual Database Tools*/						  	"{C252FEB5-A946-4202-B1D4-9916A0590387}": {make: MsBuildProject, 	icon:""},
/*Visual Studio 2015 Installer Project Extension*/	"{54435603-DBB4-11D2-8724-00A0C9A8B90C}": {make: MsBuildProject, 	icon:""},
/*Visual Studio Tools for Applications (VSTA)*/		"{A860303F-1F3F-4691-B57E-529FC101A107}": {make: MsBuildProject, 	icon:""},
/*Visual Studio Tools for Office (VSTO)*/		  	"{BAA0C2D2-18E2-41B9-852F-F413020CAA33}": {make: MsBuildProject, 	icon:""},
/*Windows Application Packaging Project (MSIX)*/	"{C7167F0D-BC9F-4E6E-AFE1-012C56B48DB5}": {make: MsBuildProject, 	icon:""},
/*Windows Communication Foundation (WCF)*/		 	"{3D9AD99F-2412-4246-B90B-4EAA41C64699}": {make: MsBuildProject, 	icon:""},
/*Windows Phone 8/8.1 Blank/Hub/Webview App*/	  	"{76F1466A-8B6D-4E39-A767-685A06062A39}": {make: MsBuildProject, 	icon:""},
/*Windows Phone 8/8.1 App (C#)*/				   	"{C089C8C0-30E0-4E22-80C0-CE093F111A43}": {make: MsBuildProject, 	icon:""},
/*Windows Phone 8/8.1 App (VB.NET)*/			   	"{DB03555F-0C8B-43BE-9FF9-57896B3C5E56}": {make: MsBuildProject, 	icon:""},
/*Windows Presentation Foundation (WPF)*/		  	"{60DC8134-EBA5-43B8-BCC9-BB4BC16C2548}": {make: MsBuildProject, 	icon:""},
/*Windows Store (Metro) Apps & Components*/			"{BC8A1FFA-BEE3-4634-8014-F334798102B3}": {make: MsBuildProject, 	icon:""},
/*Workflow (C#)*/								  	"{14822709-B5A1-4724-98CA-57A101D1B079}": {make: MsBuildProject, 	icon:""},
/*Workflow (VB.NET)*/							  	"{D59BE175-2ED0-4C54-BE3D-CDAA9F3214C8}": {make: MsBuildProject, 	icon:""},
/*Workflow Foundation*/								"{32F31D43-81CC-4C15-9DE6-3FC5453562B6}": {make: MsBuildProject, 	icon:""},
/*Workflow Foundation (Alternate)*/					"{2AA76AF3-4D9E-4AF0-B243-EB9BCDFB143B}": {make: MsBuildProject, 	icon:""},
/*XNA (Windows)*/								  	"{6D335F3A-9D43-41b4-9D22-F6F17C4BE596}": {make: MsBuildProject, 	icon:""},
/*XNA (XBox)*/									 	"{2DF5C3F4-5A5F-47A9-8E94-23B4456F55E2}": {make: MsBuildProject, 	icon:""},
/*XNA (Zune)*/									 	"{D399B71A-8929-442A-A9AC-8BEC78BB2433}": {make: MsBuildProject, 	icon:""},

/*CRM*/	                							"{88A30576-7583-4F75-8136-5EFD2C14ADFF}": {},	
/*CRM plugin*/	         							"{4C25E9B5-9FA6-436C-8E19-B395D2A65FAF}": {},	
/*IL project*/	         							"{95DFC527-4DC1-495E-97D7-E94EE1F7140D}": {},	
/*InstallShield*/	      							"{FBB4BD86-BF63-432A-A6FB-6CF3A1288F83}": {},	
/*LightSwitch Project*/								"{ECD6D718-D1CF-4119-97F3-97C25A0DFBF9}": {},	
/*Micro Framework*/	    							"{B69E3092-B931-443C-ABE7-7E7B65F2A37F}": {},	
/*Miscellaneous Files*/								"{66A2671D-8FB5-11D2-AA7E-00C04F688DDE}": {},	
/*Nomad*/	              							"{4B160523-D178-4405-B438-79FB67C8D499}": {},	
/*Synergex*/	           							"{BBD0F5D1-1CC4-42FD-BA4C-A96779C64378}": {},	
/*Unloaded Project*/	   							"{67294A52-A4F0-11D2-AA88-00C04F688DDE}": {},	
/*WiX Setup*/	          							"{930C7802-8A8C-48F9-8165-68863BCCD9DD}": {},	
};

export function getProjectIconName(guid : string) : string | undefined {
	const known = known_guids[guid];
	if (known)
		return known.icon;
}

function createProject(parent: any, basePath : string, m : string[]) : Project {
	const type = m[1];
	const name = m[2];
	const guid = m[4];
	const fullpath = path.join(basePath, m[3].replace(/\\/g, path.sep)).trim();

	const known = known_guids[m[1]];
	if (known)
		return new known.make(parent, type, name, fullpath, guid, basePath);
	return new Project(parent, type, name, fullpath, guid);
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
	}
}

function read_string0(reader: binary.reader) {
	const count = reader.read(binary.UINT32_LE);
	const name = reader.read(new binary.StringType((count - 1)* 2, 'utf-16'));
	reader.skip(2);
	return name;
}

function read_string(reader: binary.reader) {
	const count = reader.read(binary.UINT32_LE);
	const name = reader.read(new binary.StringType(count* 2, 'utf-16'));
	return name;
}

function read_token(reader: binary.reader) {
	const token = reader.read(binary.UINT16_LE);
	switch (token) {
		case 3: return reader.read(binary.UINT32_LE);
		case 8: return read_string(reader);
		default: return String.fromCharCode(token);
	}
}

function read_config(data: Uint8Array) {
	const config : Record<string, any> = {};
	const reader = new binary.reader(data);
	while (reader.remaining()) {
		const name = read_string0(reader);
		let token = read_token(reader);	//=
		const value = read_token(reader);
		config[name] = value;
		token = read_token(reader);//';'
	}

	return config;
}

function read_strings(reader: binary.reader) {
	const result : string[] = [];
	reader.skip(4);
	let num = reader.read(binary.UINT32_LE);
	while (reader.remaining() && num--) {
		const count = reader.read(binary.UINT32_LE);
		const name = reader.read(new binary.StringType(count - 2, 'utf-16'));
		result.push(name);
		reader.skip(2);
	}
	return result;
}

export class Solution {
	public projects:		Record<string, Project> = {};
	public configurations: 	Configuration[] = [];
	public currentVisualStudioVersion: string = "";
	public activeConfiguration = new Configuration("Debug", "Win32");
	public startupProject: 	Project | undefined;
	public config: 			Record<string, any> = {};
	public debug_include:	string[] = [];
	public debug_exclude:	string[] = [];

	private constructor(public readonly fullpath: string, public readonly version: string) {
		Extension.onChange(fullpath, (path:string) => {
			console.log("I've changed");
		});
	}

	static async read_suo(fullpath: string) : Promise<CompDocReader> {
		const suopath = path.join(path.dirname(fullpath), '.vs', 'shared', 'v17', '.suo');
		return vscode.workspace.fs.readFile(Uri.file(suopath))
		.then(bytes => {
			const reader = new binary.reader(bytes);
			const h = new CompDocHeader(reader);
			if (!h.valid())
				throw('invalid');
			return new CompDocReader(reader, h);
		});
	}

	public static async read(fullpath: string) : Promise<Solution | undefined> {
		const bytes = await vscode.workspace.fs.readFile(Uri.file(fullpath));
		const content = new TextDecoder().decode(bytes);
		const parser = new LineParser(content.split('\n'));

		const slnFileHeaderNoVersion: string = "Microsoft Visual Studio Solution File, Format Version ";
		for (let i = 0; i < 2; i++) {
			const str = parser.readLine();
			if (str && str.startsWith(slnFileHeaderNoVersion)) {
				const solution = new Solution(fullpath, str.substring(slnFileHeaderNoVersion.length));

				Solution.read_suo(fullpath).then(suo => {
					const configStream = suo.find("SolutionConfiguration");
					if (configStream) {
						solution.config = read_config(suo.read(configStream));
						solution.activeConfiguration	= Configuration.make(solution.config.ActiveCfg);
						solution.startupProject			= solution.projects[solution.config.StartupProject];
					}										

					const sourceStream = suo.find("DebuggerFindSource");
					if (sourceStream) {
						const reader = new binary.reader(suo.read(sourceStream));
						reader.skip(4);
						solution.debug_include = read_strings(reader);
						solution.debug_exclude = read_strings(reader);
					}	

				}).catch(error => console.log(error));
		
				solution.read(parser);
				return solution;
			}
		}
	}

	private read(parser : LineParser): void {
		let str: string | null;
		const rawProjectConfigurationsEntries: { [id: string]: string } = {};
		const basePath = path.dirname(this.fullpath);
		const projectRegEx = /Project\("(.*)"\)\s*=\s*"(.*)"\s*,\s*"(.*)"\s*,\s*"(.*)"/;

		while ((str = parser.readLine()) !== null) {
			if (str.startsWith("Project(")) {
				// Extract the important information from the first line
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
								if (m && m.length >= 2)
									proj.addDependency(this.projects[m[1].trim()]);
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

	public projectByName(name : string) {
		for (const key in this.projects) {
			if (this.projects[key].name === name)
				return this.projects[key];
		}
	}

	public configurationList() : string[] {
		return [...new Set(this.configurations.map(i => i.Configuration))];
	}
	public platformList() : string[] {
		return [...new Set(this.configurations.map(i => i.Platform))];
	}

	public async dispose() {
		const promises = Object.keys(this.projects).map(k => this.projects[k].clean());
		await Promise.all(promises);
	}
}
