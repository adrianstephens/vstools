import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import * as binary from '@shared/binary';
import * as fs from '@shared/fs';
import * as utils from '@shared/utils';
import {createTask, log} from './extension';
import {Project, SolutionFolder, WebProject, WebDeploymentProject} from './Project';
import * as CompDoc from '@shared/CompoundDocument';
import {MsBuildProject, ManagedProjectMaker, CPSProjectMaker, ESProject, AndroidProject} from './MsBuildProject';
import {VCProject} from './vcxproj';

const known_guids : Record<string, {make: new (parent: any, type: string, name: string, fullpath: string, guid: string, solution_dir: string)=>Project, icon?: string}> = {
/*Web Site*/										"{E24C65DC-7377-472B-9ABA-BC803B73C61A}": {make: WebProject},
/*Solution Folder*/									"{2150E333-8FDC-42A3-9474-1A3956D46DE8}": {make: SolutionFolder,					icon:"FolderClosed"},
/*wdProjectGuid*/ 									"{2CFEAB61-6A3B-4EB8-B523-560B4BEEF521}": {make: WebDeploymentProject},

/*CPS*/ 											"{13B669BE-BB05-4DDF-9536-439F39A36129}": {make: CPSProjectMaker('?', '*')},
/*ASP.NET 5*/									  	"{8BB2217D-0F2D-49D1-97BC-3654ED321F3B}": {make: MsBuildProject},
/*ASP.NET Core Empty*/							 	"{356CAE8B-CFD3-4221-B0A8-081A261C0C10}": {make: MsBuildProject},
/*ASP.NET Core Web API*/						   	"{687AD6DE-2DF8-4B75-A007-DEF66CD68131}": {make: MsBuildProject},
/*ASP.NET Core Web App*/						   	"{E27D8B1D-37A3-4EFC-AFAE-77744ED86BCA}": {make: MsBuildProject},
/*ASP.NET Core Web App (Model-View-Controller)*/	"{065C0379-B32B-4E17-B529-0A722277FE2D}": {make: MsBuildProject},
/*ASP.NET Core with Angular*/					  	"{32F807D6-6071-4239-8605-A9B2205AAD60}": {make: MsBuildProject},
/*ASP.NET Core with React.js*/					 	"{4C3A4DF3-0AAD-4113-8201-4EEEA5A70EED}": {make: MsBuildProject},
/*ASP.NET MVC 1*/								  	"{603C0E0B-DB56-11DC-BE95-000D561079B0}": {make: MsBuildProject},
/*ASP.NET MVC 2*/								  	"{F85E285D-A4E0-4152-9332-AB1D724D3325}": {make: MsBuildProject},
/*ASP.NET MVC 3*/								  	"{E53F8FEA-EAE0-44A6-8774-FFD645390401}": {make: MsBuildProject},
/*ASP.NET MVC 4*/								  	"{E3E379DF-F4C6-4180-9B81-6769533ABE47}": {make: MsBuildProject},
/*ASP.NET MVC 5 / Web Application*/					"{349C5851-65DF-11DA-9384-00065B846F21}": {make: MsBuildProject},
/*Azure Functions*/									"{30E03E5A-5F87-4398-9D0D-FEB397AFC92D}": {make: MsBuildProject},
/*Azure Resource Group (Blank Template)*/		  	"{14B7E1DC-C58C-427C-9728-EED16291B2DA}": {make: MsBuildProject},
/*Azure Resource Group (Web app)*/				 	"{E2FF0EA2-4842-46E0-A434-C62C75BAEC67}": {make: MsBuildProject},
/*Azure WebJob (.NET Framework)*/				  	"{BFBC8063-F137-4FC6-AEB4-F96101BA5C8A}": {make: MsBuildProject},
/*Blazor Server App*/							  	"{C8A4CD56-20F4-440B-8375-78386A4431B9}": {make: MsBuildProject},
/*C#*/											 	"{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}": {make: CPSProjectMaker('CSharp', 'cs'),	icon:"CSProjectNode"},
/*C# (.Net Core)*/								 	"{9A19103F-16F7-4668-BE54-9A1E7A4F7556}": {make: CPSProjectMaker('CSharp', 'cs'), 	icon:"CSProjectNode"},
/*C++*/												"{8BC9CEB8-8B4A-11D0-8D11-00A0C91BC942}": {make: VCProject, 						icon:"CPPProjectNode"},
/*Class Library*/								  	"{2EFF6E4D-FF75-4ADF-A9BE-74BEC0B0AFF8}": {make: MsBuildProject},
/*Console App*/										"{008A663C-3F22-40EF-81B0-012B6C27E2FB}": {make: MsBuildProject},
/*Database*/ 										"{C8D11400-126E-41CD-887F-60BD40844F9E}": {make: MsBuildProject},
/*Database*/									   	"{A9ACE9BB-CECE-4E62-9AA4-C7E7C5BD2124}": {make: MsBuildProject},
/*Database (other project types)*/				 	"{4F174C21-8C12-11D0-8340-0000F80270F8}": {make: MsBuildProject},
/*Deployment Cab*/								 	"{3EA9E505-35AC-4774-B492-AD1749C4943A}": {make: MsBuildProject},
/*Deployment Merge Module*/							"{06A35CCD-C46D-44D5-987B-CF40FF872267}": {make: MsBuildProject},
/*Deployment Setup*/							   	"{978C614F-708E-4E1A-B201-565925725DBA}": {make: MsBuildProject},
/*Deployment Smart Device Cab*/						"{AB322303-2255-48EF-A496-5904EB18DA55}": {make: MsBuildProject},
/*Distributed System*/							 	"{F135691A-BF7E-435D-8960-F99683D2D49C}": {make: MsBuildProject},
/*Dynamics 2012 AX C# in AOT*/					 	"{BF6F8E12-879D-49E7-ADF0-5503146B24B8}": {make: MsBuildProject},
/*Extensibility*/								  	"{82B43B9B-A64C-4715-B499-D71E9CA2BD60}": {make: MsBuildProject},
/*F#*/											 	"{F2A71F9B-5D33-465A-A702-920D77279786}": {make: ManagedProjectMaker('FSharp'), 	icon:"FSProjectNode"},
/*F# (CPS)*/ 										"{6EC3EE1D-3C4E-46DD-8F32-0CC8E7565705}": {make: CPSProjectMaker('FSharp', 'fs'),	icon:"FSProjectNode"},
/*J#*/											 	"{E6FDF86B-F3D1-11D4-8576-0002A516ECE8}": {make: MsBuildProject, 					icon:"JSProjectNode"},
/*JScript*/											"{262852C6-CD72-467D-83FE-5EEB1973A190}": {make: MsBuildProject},
/*Legacy (2003) Smart Device (C#)*/					"{20D4826A-C6FA-45DB-90F4-C717570B9F32}": {make: MsBuildProject},
/*Legacy (2003) Smart Device (VB.NET)*/				"{CB4CE8C6-1BDB-4DC7-A4D3-65A1999772F8}": {make: MsBuildProject},
/*LightSwitch*/										"{8BB0C5E8-0616-4F60-8E55-A43933E57E9C}": {make: MsBuildProject},
/*Lightswitch*/										"{DA98106F-DEFA-4A62-8804-0BD2F166A45D}": {make: MsBuildProject},
/*LightSwitch Project*/								"{581633EB-B896-402F-8E60-36F3DA191C85}": {make: MsBuildProject},
/*Micro Framework*/									"{B69E3092-B931-443C-ABE7-7E7b65f2A37F}": {make: MsBuildProject},
/*Mono for Android / Xamarin.Android*/				"{EFBA0AD7-5A72-4C68-AF49-83D382785DCF}": {make: MsBuildProject},
/*MonoDevelop Addin*/							  	"{86F6BF2A-E449-4B3E-813B-9ACC37E5545F}": {make: MsBuildProject},
/*MonoTouch  Xamarin.iOS*/							"{6BC8ED88-2882-458C-8E55-DFD12B67127B}": {make: MsBuildProject},
/*MonoTouch Binding*/							  	"{F5B4F3BC-B597-4E2B-B552-EF5D8A32436F}": {make: MsBuildProject},
/*Office/SharePoint App*/						  	"{C1CDDADD-2546-481F-9697-4EA41081F2FC}": {make: MsBuildProject},
/*Platform Toolset v120*/						  	"{8DB26A54-E6C6-494F-9B32-ACBB256CD3A5}": {make: MsBuildProject},
/*Platform Toolset v141*/						  	"{C2CAFE0E-DCE1-4D03-BBF6-18283CF86E48}": {make: MsBuildProject},
/*Portable Class Library*/						 	"{786C830F-07A1-408B-BD7F-6EE04809D6DB}": {make: MsBuildProject},
/*PowerShell*/									 	"{F5034706-568F-408A-B7B3-4D38C6DB8A32}": {make: MsBuildProject},
/*Project Folders*/									"{66A26720-8FB5-11D2-AA7E-00C04F688DDE}": {make: MsBuildProject},
/*Python*/										 	"{888888A0-9F3D-457C-B088-3A5042F75D52}": {make: MsBuildProject},
/*SharePoint (C#)*/									"{593B0543-81F6-4436-BA1E-4747859CAAE2}": {make: MsBuildProject},
/*SharePoint (VB.NET)*/								"{EC05E597-79D4-47F3-ADA0-324C4F7C7484}": {make: MsBuildProject},
/*SharePoint Workflow*/								"{F8810EC1-6754-47FC-A15F-DFABD2E3FA90}": {make: MsBuildProject},
/*Silverlight*/										"{A1591282-1198-4647-A2B1-27E5FF5F6F3B}": {make: MsBuildProject},
/*Smart Device (C#)*/							  	"{4D628B5B-2FBC-4AA6-8C16-197242AEB884}": {make: MsBuildProject},
/*Smart Device (VB.NET)*/						  	"{68B1623D-7FB9-47D8-8664-7ECEA3297D4F}": {make: MsBuildProject},
/*SSIS*/										   	"{159641D6-6404-4A2A-AE62-294DE0FE8301}": {make: MsBuildProject},
/*SSIS*/										   	"{D183A3D8-5FD8-494B-B014-37F57B35E655}": {make: MsBuildProject},
/*SSIS*/										   	"{C9674DCB-5085-4A16-B785-4C70DD1589BD}": {make: MsBuildProject},
/*SSRS*/										   	"{F14B399A-7131-4C87-9E4B-1186C45EF12D}": {make: MsBuildProject},
/*Shared Project*/								 	"{D954291E-2A0B-460D-934E-DC6B0785DB48}": {make: MsBuildProject},
/*Test*/										   	"{3AC096D0-A1C2-E12C-1390-A8335801FDAB}": {make: MsBuildProject},
/*Universal Windows Class Library (UWP)*/		  	"{A5A43C5B-DE2A-4C0C-9213-0A381AF9435A}": {make: MsBuildProject},
/*VB.NET*/										 	"{F184B08F-C81C-45F6-A57F-5ABD9991F28F}": {make: ManagedProjectMaker('VisualBasic'),	icon:"VBProjectNode"},
/*VB.NET (CPS)*/								 	"{778DAE3C-4631-46EA-AA77-85C1314464D9}": {make: CPSProjectMaker('VisualBasic', 'vb'),	icon:"VBProjectNode"},
/*Visual Database Tools*/						  	"{C252FEB5-A946-4202-B1D4-9916A0590387}": {make: MsBuildProject},
/*Visual Studio 2015 Installer Project Extension*/	"{54435603-DBB4-11D2-8724-00A0C9A8B90C}": {make: MsBuildProject},
/*Visual Studio Tools for Applications (VSTA)*/		"{A860303F-1F3F-4691-B57E-529FC101A107}": {make: MsBuildProject},
/*Visual Studio Tools for Office (VSTO)*/		  	"{BAA0C2D2-18E2-41B9-852F-F413020CAA33}": {make: MsBuildProject},
/*Windows Application Packaging Project (MSIX)*/	"{C7167F0D-BC9F-4E6E-AFE1-012C56B48DB5}": {make: MsBuildProject},
/*Windows Communication Foundation (WCF)*/		 	"{3D9AD99F-2412-4246-B90B-4EAA41C64699}": {make: MsBuildProject},
/*Windows Phone 8/8.1 Blank/Hub/Webview App*/	  	"{76F1466A-8B6D-4E39-A767-685A06062A39}": {make: MsBuildProject},
/*Windows Phone 8/8.1 App (C#)*/				   	"{C089C8C0-30E0-4E22-80C0-CE093F111A43}": {make: MsBuildProject},
/*Windows Phone 8/8.1 App (VB.NET)*/			   	"{DB03555F-0C8B-43BE-9FF9-57896B3C5E56}": {make: MsBuildProject},
/*Windows Presentation Foundation (WPF)*/		  	"{60DC8134-EBA5-43B8-BCC9-BB4BC16C2548}": {make: MsBuildProject},
/*Windows Store (Metro) Apps & Components*/			"{BC8A1FFA-BEE3-4634-8014-F334798102B3}": {make: MsBuildProject},
/*Workflow (C#)*/								  	"{14822709-B5A1-4724-98CA-57A101D1B079}": {make: MsBuildProject},
/*Workflow (VB.NET)*/							  	"{D59BE175-2ED0-4C54-BE3D-CDAA9F3214C8}": {make: MsBuildProject},
/*Workflow Foundation*/								"{32F31D43-81CC-4C15-9DE6-3FC5453562B6}": {make: MsBuildProject},
/*Workflow Foundation (Alternate)*/					"{2AA76AF3-4D9E-4AF0-B243-EB9BCDFB143B}": {make: MsBuildProject},
/*XNA (Windows)*/								  	"{6D335F3A-9D43-41b4-9D22-F6F17C4BE596}": {make: MsBuildProject},
/*XNA (XBox)*/									 	"{2DF5C3F4-5A5F-47A9-8E94-23B4456F55E2}": {make: MsBuildProject},
/*XNA (Zune)*/									 	"{D399B71A-8929-442A-A9AC-8BEC78BB2433}": {make: MsBuildProject},


/*'Javascript Application Project Files'*/			"{54A90642-561A-4BB1-A94E-469ADEE60C69}": {make: ESProject,		icon:"TSProjectNode"},
/*Android Packaging Projects'*/						"{39E2626F-3545-4960-A6E8-258AD8476CE5}": {make: AndroidProject},

/*CRM*/	                							"{88A30576-7583-4F75-8136-5EFD2C14ADFF}": {make: Project},	
/*CRM plugin*/	         							"{4C25E9B5-9FA6-436C-8E19-B395D2A65FAF}": {make: Project},	
/*IL project*/	         							"{95DFC527-4DC1-495E-97D7-E94EE1F7140D}": {make: Project},	
/*InstallShield*/	      							"{FBB4BD86-BF63-432A-A6FB-6CF3A1288F83}": {make: Project},	
/*LightSwitch Project*/								"{ECD6D718-D1CF-4119-97F3-97C25A0DFBF9}": {make: Project},	
/*Micro Framework*/	    							"{B69E3092-B931-443C-ABE7-7E7B65F2A37F}": {make: Project},	
/*Miscellaneous Files*/								"{66A2671D-8FB5-11D2-AA7E-00C04F688DDE}": {make: Project},	
/*Nomad*/	              							"{4B160523-D178-4405-B438-79FB67C8D499}": {make: Project},	
/*Synergex*/	           							"{BBD0F5D1-1CC4-42FD-BA4C-A96779C64378}": {make: Project},	
/*Unloaded Project*/	   							"{67294A52-A4F0-11D2-AA88-00C04F688DDE}": {make: Project},	
/*WiX Setup*/	          							"{930C7802-8A8C-48F9-8165-68863BCCD9DD}": {make: Project},	
};

const known_exts : Record<string, string> = {
	csproj:		"{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}",	//'C# Project Files',
	fsproj:		"{F2A71F9B-5D33-465A-A702-920D77279786}",	//'F# Project Files',
	vbproj:		"{F184B08F-C81C-45F6-A57F-5ABD9991F28F}",	//'VB Project Files',
	shproj:		"{D954291E-2A0B-460D-934E-DC6B0785DB48}",	//'Shared Projects',
	wapproj:	"{C7167F0D-BC9F-4E6E-AFE1-012C56B48DB5}",	//'WAPProj Project Files',
	vcxproj:	"{8BC9CEB8-8B4A-11D0-8D11-00A0C91BC942}",	//'VC++ Project Files',
	vcxitems:	"{8BC9CEB8-8B4A-11D0-8D11-00A0C91BC942}",	//'VC++ Project Files',
	xproj:		"{8BB2217D-0F2D-49D1-97BC-3654ED321F3B}",	//'.NET Core 2015 Project Files',
	esproj:		"{54A90642-561A-4BB1-A94E-469ADEE60C69}",	//'Javascript Application Project Files',
	androidproj:"{39E2626F-3545-4960-A6E8-258AD8476CE5}",	//Android Packaging Projects',
	msbuildproj:"{13B669BE-BB05-4DDF-9536-439F39A36129}",	//'Common Project System Files',
};

function createProject(parent:Solution, type:string, name:string, fullpath: string, guid: string) {
	const basePath 	= path.dirname(parent.fullpath);
	const known 	= known_guids[type];
	return known
		? new known.make(parent, type, name, fullpath, guid, basePath)
		: new Project(type, name, fullpath, guid, basePath);
}



export function getProjectIconName(guid : string) : string | undefined {
	return known_guids[guid]?.icon;
}

class Histogram {
	private data: Record<string, number> = {};
	add(key: string) 	{ this.data[key] = (this.data[key] || 0) + 1; }
	get(key: string) 	{ return this.data[key] || 0; }
    keys()				{ return Object.keys(this.data); }
    clear() 			{ for (const key of this.keys()) delete this.data[key]; }
}

function best_config(configs: string[], config: string, histogram: Histogram) {
	if (configs.length == 0 || configs.includes(config))
		return config;
	const counts	= configs.map(i => histogram.get(i));
	const max		= counts.reduce((acc, i) => Math.max(acc, i));
	return configs[counts.indexOf(max)];
}

//-----------------------------------------------------------------------------
//	line parsing, writing
//-----------------------------------------------------------------------------

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
	public parseSection_re(end: string, re: RegExp, func: (m: RegExpExecArray) => void): void {
		let str: string | null;
		while ((str = this.readLine()) !== null && str !== end) {
			const m = re.exec(str);
			if (m)
				func(m);
		}
	}
}

export function write_section(type:string, name:string, when: string, section: Record<string, string>) {
	const entries = Object.entries(section);
	return entries.length == 0 ? '' : `\t${type}(${name}) = ${when}\n${entries.map(([k,v]) => `\t\t${k} = ${v}`).join('\n')}\n\tEnd${type}\n`;
}

//-----------------------------------------------------------------------------
//	suo helpers
//-----------------------------------------------------------------------------

const string0Type	= binary.StringType(binary.UINT32_LE, 'utf16le', true);
const stringType	= binary.StringType(binary.UINT32_LE, 'utf16le', false);
const string1Type	= binary.StringType(binary.UINT32_LE, 'utf16le', true, 1);
const stringArrayType = binary.ArrayType(binary.UINT32_LE, string1Type);

function read_token(reader: binary.stream) {
	const token = binary.read(reader, binary.UINT16_LE);
	switch (token) {
		case 3: return binary.read(reader, binary.UINT32_LE);
		case 8: return binary.read(reader, stringType);
		default: return String.fromCharCode(token);
	}
}

function read_config(data: Uint8Array) {
	const config : Record<string, any> = {};
	const reader = new binary.stream(data);
	while (reader.remaining()) {
		const name = binary.read(reader, string0Type);
		let token = read_token(reader);	//=
		const value = read_token(reader);
		config[name] = value;
		token = read_token(reader);//';'
	}

	return config;
}

function write_token(writer: binary.stream, token: any) {
	switch (typeof token) {
		case 'number': binary.write(writer, binary.UINT16_LE, 3); binary.write(writer, binary.UINT32_LE, token); break;
		case 'string': binary.write(writer, binary.UINT16_LE, 8); binary.write(writer, stringType, token); break;
		default: throw "bad token";
	}
}
function write_char_token(writer: binary.stream, token: string) {
	binary.write(writer, binary.UINT16_LE, token.charCodeAt(0));
}

function write_config(config : Record<string, any>): Uint8Array {
	const writer = new binary.stream_grow();
	Object.entries(config).forEach(([name, value]) => {
		binary.write(writer, string0Type, name);
		write_char_token(writer, '=');	//=
		write_token(writer, value);
		write_char_token(writer, ';');	//=
	});
	return writer.terminate();
}

async function open_suo(filename: string) : Promise<CompDoc.Reader> {
	return fs.loadFile(filename).then(bytes => {
		if (bytes) {
			const h = new CompDoc.Header(new binary.stream(bytes));
			if (h.valid())
				return new CompDoc.Reader(bytes.subarray(h.sector_size()), h);
		}
		throw('invalid');
	});
}

function suo_path(filename: string) {
	return path.join(path.dirname(filename), '.vs', 'shared', 'v17', '.suo');
}

//-----------------------------------------------------------------------------
//	Solution
//-----------------------------------------------------------------------------

export class Solution {
	public projects:		Record<string, Project> = {};
	public parents:			Record<string, Project> = {};
	public debug_include:	string[]	= [];
	public debug_exclude:	string[]	= [];

	private config_list: 	string[]	= [];
	private platform_list: 	string[]	= [];

	private header						= '';
	private VisualStudioVersion			= '';
	private MinimumVisualStudioVersion	= '';
	private global_sections: Record<string, {section: Record<string, string>, when:string}> = {};
	private	active						= [0, 0];
	private	config:			Record<string, any> = {};
	private writing			= false;
	private _onDidChange	= new vscode.EventEmitter<string>();


	update = new utils.CallCombiner(async () => {
		this.writing = true;
		await fs.writeTextFile(this.fullpath, this.format());
		setTimeout(() => this.writing = false, 1000);
	}, 2000);

	update_suo = new utils.CallCombiner(async () => {
		const suopath = suo_path(this.fullpath);
		open_suo(suopath).then(suo => {
			const configStream = suo.find("SolutionConfiguration");
			if (configStream) {
				const config	= this.config;
				const data2 	= write_config(config);
				const config2	= read_config(data2);
				log(config2.toString());
				suo.write(configStream, data2);
				suo.flush(suopath);
			}
		});
	}, 2000);

	get onDidChange() {
		return this._onDidChange.event;
	}

	public get startup() : Project | undefined {
		return this.projects[this.config.StartupProject];
	}
	public set startup(project: Project | string) {
		if (typeof project !== 'string')
			project = project.guid;
		if (this.config.StartupProject !== project) {
			this.config.StartupProject = project;
			this.dirty_suo();
			this._onDidChange.fire('startup');
		}
	}

	public get activeConfiguration() {
		return {
			Configuration:	this.config_list[this.active[0]],
			Platform: 		this.platform_list[this.active[1]]
		};
	}
	public set activeConfiguration({Configuration, Platform}: {Configuration: string, Platform: string}) {
		const c = this.config_list.indexOf(Configuration);
		const p = this.platform_list.indexOf(Platform);

		if ((c >= 0 && c !== this.active[0]) || (p >= 0 && p !== this.active[1])) {
			if (c >= 0)
				this.active[0]	= c;
			else
				Configuration	= this.config_list[this.active[0]];

			if (p >= 0)
				this.active[1]	= p;
			else
				Platform	= this.platform_list[this.active[1]];

			this.config.ActiveCfg = `${Configuration}|${Platform}`;
			this.dirty_suo();
			this._onDidChange.fire('config');
		}
	}

	public projectActiveConfiguration(project: Project) {
		const c = project.configuration[this.active.join('|')];
		return {
			Configuration:	c?.Configuration ?? this.config_list[this.active[0]],
			Platform: 		c?.Platform ?? this.platform_list[this.active[1]],
		};
	}

	public get childProjects() {
		return Object.keys(this.projects).filter(p => !this.parents[p]).map(p => this.projects[p]);
	}

	dispose() {
		utils.asyncMap(Object.keys(this.projects), async k => this.projects[k].clean());
	}

	private constructor(public fullpath: string) {

		fs.onChange(fullpath, async (newpath:string, mode: number) => {
			switch (mode) {
				case fs.Change.changed: {
					if (this.writing)
						break;
					log("I've changed");
					const parser = await Solution.getParser(fullpath);
					if (parser) {
						this.parse(parser);
						this._onDidChange.fire('change');
					}
				}
				//fallthrough
				case fs.Change.deleted:
					this._onDidChange.fire('remove');
					break;

				case fs.Change.renamed:
					if (path.extname(newpath) === '.sln') {
						this.fullpath = newpath;
						this._onDidChange.fire('rename');
					} else {
						this._onDidChange.fire('remove');
					}
					break;
			}
		});
	}

	private static async getParser(fullpath: string) {
		const bytes		= await fs.loadFile(fullpath);
		if (bytes) {
			const content	= new TextDecoder().decode(bytes);
			const parser	= new LineParser(content.split('\n'));

			const slnFileHeaderNoVersion: string = "Microsoft Visual Studio Solution File, Format Version ";
			for (let i = 0; i < 2; i++) {
				const str = parser.readLine();
				if (str && str.startsWith(slnFileHeaderNoVersion))
					return parser;
			}
		}
	}

	public static async load(fullpath: string) : Promise<Solution | undefined> {
		const parser = await this.getParser(fullpath);
		if (parser) {
			const solution = new Solution(fullpath);

			const aconfig = open_suo(suo_path(fullpath)).then(suo => {
				const sourceStream = suo.find("DebuggerFindSource");
				if (sourceStream) {
					const reader = new binary.stream(suo.read(sourceStream));
					reader.skip(4);
					reader.skip(4);
					solution.debug_include = binary.read(reader, stringArrayType);
					reader.skip(4);
					solution.debug_exclude = binary.read(reader, stringArrayType);
				}	

				const configStream = suo.find("SolutionConfiguration");
				return configStream && read_config(suo.read(configStream));

			}).catch(error => (log(error), undefined));
	
			solution.parse(parser);
	
			solution.config = await aconfig ?? {};
			const parts		= solution.config.ActiveCfg.split('|');
			solution.active	= [Math.max(solution.config_list.indexOf(parts[0]), 0), Math.max(solution.platform_list.indexOf(parts[1]), 0)];
			return solution;
		}
	}

	public dirty() {
		this._onDidChange.fire("something");
		this.update.trigger();
	}

	private dirty_suo() {
		this.update_suo.trigger();
	}

	private parse(parser : LineParser): void {
		this.header						= parser.currentLine();
		this.config_list.length 		= 0;
		this.platform_list.length 		= 0;
		this.VisualStudioVersion		= '';
		this.MinimumVisualStudioVersion	= '';
		this.global_sections			= {};
		this.projects					= {};

		let str: string | null;
		let m: RegExpExecArray | null;
		const basePath = path.dirname(this.fullpath);
		const assign_re		= /\s*(.*?)\s*=\s*(.*)/;

		while ((str = parser.readLine()) !== null) {
			if ((m = assign_re.exec(str))) {
				const name	= m[1];
				const value	= m[2].trim();

				if (name === "VisualStudioVersion") {
					this.VisualStudioVersion = value;

				} else if (name === "MinimumVisualStudioVersion") {
					this.MinimumVisualStudioVersion = value;

				} else if ((m = /Project\("(.*)"\)/.exec(name))) {
					const type = m[1];
					if ((m = /"(.*)"\s*,\s*"(.*)"\s*,\s*"(.*)"/.exec(value))) {
						const guid 	= m[3];
						const proj 	= Project.all[guid] ?? createProject(this, type, m[1], path.resolve(basePath, m[2]), guid);
						this.projects[guid] = proj;

						parser.parseSection_re("EndProject", assign_re, m => {
							if (m[1] === "ProjectSection(SolutionItems)") {
								parser.parseSection_re("EndProjectSection", assign_re, m => {
									proj.addFile(path.basename(m[1]), path.resolve(basePath, m[2].trim()), false);
								});

							} else if (m[1] === "ProjectSection(ProjectDependencies)") {
								parser.parseSection_re("EndProjectSection", assign_re, m => {
									proj.addDependency(this.projects[m[1]]);
								});

							} else if (m[1] === "ProjectSection(WebsiteProperties)") {
								parser.parseSection_re("EndProjectSection", assign_re, m => {
									proj.addWebProperty(m[1], m[2].trim());
								});
							}
						});
					}

				} else if ((m = /GlobalSection\((.*)\)/.exec(name))) {
					const section : Record<string, string> = {};
					parser.parseSection_re("EndGlobalSection", assign_re, m => section[m[1]] = m[2].trim());
					this.global_sections[m[1]] = {section: section, when: value};
				}
			}
		}

		const detach_globals = (name: string) : Record<string, string> => {
			const section = this.global_sections[name];
			if (section) {
				const r = section.section;
				section.section = {};
				return r;
			}
			return {};
		};
	
		Object.entries(detach_globals('NestedProjects')).forEach(([k, v]) => {
			this.projects[v]?.addProject(this.projects[k]);
			this.parents[k] = this.projects[v];
		});

		const configurations= Object.keys(detach_globals('SolutionConfigurationPlatforms')).filter(k => k !== 'DESCRIPTION').map(k => k.split('|'));
	
		const config_set	= new Set(configurations.map(i => i[0]));
		const platform_set	= new Set(configurations.map(i => i[1]));

		this.config_list	= [...config_set];
		this.platform_list	= [...platform_set];

		const config_map	= Object.fromEntries(this.config_list.map((v, i) => [v, i]));
		const platform_map	= Object.fromEntries(this.platform_list.map((v, i) => [v, i]));

		const rawProjectConfigurationsEntries = detach_globals('ProjectConfigurationPlatforms');
		for (const key in this.projects) {
			const project = this.projects[key];
			for (const c of configurations) {
				const configuration = `${project.guid}.${c.join('|')}`;
				const config = rawProjectConfigurationsEntries[configuration + ".ActiveCfg"];
				if (config) {
					const build		= rawProjectConfigurationsEntries[configuration + ".Build.0"];
					const deploy 	= rawProjectConfigurationsEntries[configuration + ".Deploy.0"];
					const key		= [config_map[c[0]], platform_map[c[1]]].join('|');
					const parts 	= config.split('|');
					project.setProjectConfiguration(key, {Configuration:parts[0], Platform:parts[1], build:!!build, deploy:!!deploy});
				}
			}
		}
	}

	private format(): string {
		const basePath = path.dirname(this.fullpath);
		let out = `
${this.header}
VisualStudioVersion = ${this.VisualStudioVersion}
MinimumVisualStudioVersion = ${this.MinimumVisualStudioVersion}
`;

		for (const p in this.projects) {
			const proj = this.projects[p];
			out += `Project("${proj.type}") = "${proj.name}", "${path.relative(basePath, proj.fullpath)}", "${p}"\n`;
			out += proj.solutionWrite(basePath);

			if (!(proj instanceof MsBuildProject))
				out += write_section('ProjectSection', 'ProjectDependencies', 'preProject', Object.fromEntries(proj.dependencies.map(i => [i.name, i.name])));
	
			out += write_section('ProjectSection', 'WebsiteProperties', 'preProject', proj.webProperties);

			out += "EndProject\n";
		}

		out += "Global\n";
		for (const i in this.global_sections) {
			let section = this.global_sections[i].section;
			switch (i) {
				case 'SolutionConfigurationPlatforms':
					section = Object.fromEntries(this.config_list.map(c => this.platform_list.map(p => `${c}|${p}`)).flat().map(i => [i, i]));
					break;
				case 'ProjectConfigurationPlatforms':
					section = Object.entries(this.projects).reduce((acc, [p, project]) =>
						Object.entries(project.configuration).reduce((acc, [i, c]) => {
							const parts = i.split('|');
							if (this.config_list[+parts[0]] && this.platform_list[+parts[1]]) {
								const key		= [this.config_list[+parts[0]], this.platform_list[+parts[1]]].join('|');
								const config	= [c.Configuration, c.Platform].join('|');
								acc[`${p}.${key}.ActiveCfg`] = config;
								if (c.build)
									acc[`${p}.${key}.Build.0`] = config;
								if (c.deploy)
									acc[`${p}.${key}.Deploy.0`] = config;
							}
							return acc;
						}, acc), {} as Record<string, string>);
					break;
				case 'NestedProjects':
					section = Object.entries(this.projects).reduce((acc, [p, project]) =>
						project.childProjects.reduce((acc, i) => {
							acc[i.guid] = p;
							return acc;
						}, acc), {} as Record<string, string>);
					break;
				default:
					break;
			}
			out += write_section('GlobalSection', i, this.global_sections[i].when, section);
		}
		out += "EndGlobal\n";

		return out;
	}

	public projectByName(name : string) {
		for (const key in this.projects) {
			if (this.projects[key].name === name)
				return this.projects[key];
		}
	}

	private makeProxy(array: string[]) {
		return new Proxy(array, {
			set: (target: string[], prop: string, value: string) => {
				target[+prop] = value;
				this.dirty();
				return true;
			},
			deleteProperty: (target: string[], prop: string) => {
				delete target[+prop];
				this.dirty();
				return true;
			}
		});
	}

	public configurationList() : string[] {
		return this.makeProxy(this.config_list);
	}
	public platformList() : string[] {
		return this.makeProxy(this.platform_list);
	}
	public async addProject(proj: Project) {
		if (!proj.guid)
			proj.guid = crypto.randomUUID();

		//make histograms of all mappings from solution config/plat to project config/plat
		const chistogram: Histogram[] = utils.array_make(this.config_list.length, Histogram);
		const phistogram: Histogram[] = utils.array_make(this.platform_list.length, Histogram);

		for (const c in this.config_list) {
			chistogram[c] = new Histogram;
			for (const p in this.platform_list) {
				const key = `${c}|${p}`;
				for (const i of Object.values(this.projects)) {
					const config = i.configuration[key];
					if (config) {
						chistogram[c].add(config.Configuration);
						phistogram[p].add(config.Platform);
					}
				}
			}
		}

		await proj.ready;

		// find most common mappings that are supported by this project
		const proj_configs	= proj.configurationList();
		const config_map	= this.config_list.map((c, i) => best_config(proj_configs, c, chistogram[i]));

		const proj_plats	= proj.platformList();
		const plat_map		= this.platform_list.map((p, i) => best_config(proj_plats, p, phistogram[i]));

		// make map
		for (const c in this.config_list) {
			for (const p in this.platform_list) {
				proj.setProjectConfiguration(`${c}|${p}`, {
					Configuration:	config_map[c],
					Platform:		plat_map[p],
					build: 			true,
					deploy: 		true
				});
			}
		}

		// add project to solution
		this.projects[proj.guid] = proj;
		this.dirty();
	}

	public async addProjectFilename(filename: string) {
		const parsed	= path.parse(filename);
		const type		= known_exts[parsed.ext.substring(1)];
		this.addProject(createProject(this, type, parsed.name, filename, ''));
	}

	public removeProject(project: Project) {
		this.parents[project.guid]?.removeProject(project);
		delete this.projects[project.guid];
		this.dirty();
	}

	public build(settings : Record<string, string>) {
		const task = createTask("Build Solution", "Build", this.fullpath, settings);
		vscode.tasks.executeTask(task);
	}
}
