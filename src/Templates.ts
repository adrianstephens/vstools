import * as path from 'path';
import * as crypto from 'crypto';
import * as xml from '@shared/xml';
import * as fs from '@shared/fs';
import * as utils from '@shared/utils';
import { CLR } from '@shared/clr';
import { PE } from '@shared/pe';
import { XMLCache, vsdir, log } from './extension';
import {Locations} from './MsBuild';
import {execFile} from 'child_process';
import * as insensitive from '@shared/CaseInsensitive';

function replace(s: string, substitutions: Record<string, string>) {
	return utils.replace(s, /\$(\w+)\$/g, m=> substitutions[m[1]] ?? process.env[m[1]] ?? m[0]);
}

//-----------------------------------------------------------------------------
//	virtual registry (formed by scanning pkgdef files)
//-----------------------------------------------------------------------------

type RegistryData = { [key: string]: any };

function parseReg(data: string, filename: string, substitutions: Record<string, string>) {
	const	result: RegistryData = {};
	let		dest = result;

	for (const line of data.split('\n')) {
		if (line[0] == '[') {
			dest = result;
			for (const part of line.trim().slice(1, -1).split('\\')) {
				if (!(part in dest)) {
					dest[part] = {};
				} else if (typeof dest[part] !== 'object') {
					dest[part] = {'': dest[part]};
				}
				dest = dest[part];
			}
		} else {
			const m = line.match(/^("(.+)"|@)=("(.*)"|dword:([a-fA-F0-9]+))/);
			if (m)
				dest[m[2]??''] = m[4] ? replace(m[4], substitutions) : parseInt(m[5], 16);
		}
	}
	return result;
}

const virtual_registry = new utils.Lazy(() => {
	const reg_substitutions: Record<string, string> = {
		'BaseInstallDir':	vsdir + '\\',
		'RootFolder':		vsdir,
		'ShellFolder':		vsdir,
		'System':			path.join(process.env.SystemRoot??'', 'system32'),
	//	'RootKey':			'Root',
	//	'hostexe':
	};
	return fs.mapDirs(
		path.join(vsdir, 'Common7','IDE'), '*.pkgdef',
		filename => fs.loadTextFile(filename).then(
			data => parseReg(data, filename, {...reg_substitutions, PackageFolder: path.dirname(filename)}
		)),
		utils.merge
	);
});

//-----------------------------------------------------------------------------
//	string resources
//-----------------------------------------------------------------------------

class Resources {
	static async load(dll: string) {
		const data = await fs.loadFile(dll);
		const p = data && new PE(data);
		if (p && p.opt) {
			//const res_dir	= p.opt.DataDirectory.RESOURCE;
			const native	= p.ReadDirectory('RESOURCE');
			const clr_dir	= p.opt.DataDirectory.CLR_DESCRIPTOR;
			const managed	= clr_dir.Size && new CLR(p, p.GetDataDir(clr_dir)!.data).allResources();
			return new Resources(native, managed);
		}
	}

	constructor(public native: any, public managed: any) {}

	getString(id:string) {
		if (this.native) {
			const strings = this.native[6];
			if (strings) {
				let r = strings[id];
				if (r)
					return r;
				if ((r = strings[(+id >> 4) + 1])) {
					const data	= r[1033].data as Uint8Array;
					const dv	= new DataView(data.buffer, data.byteOffset, data.byteLength);
					let offset = 0;
					for (let i = +id & 15; i--;)
						offset += dv.getUint16(offset, true) * 2 + 2;
					return new TextDecoder('utf-16').decode(data.slice(offset + 2, offset + 2 + dv.getUint16(offset, true) * 2));
				}
			}
		}
		return this.managed?.[id];
	}
}

const ResCache	= utils.makeCache(Resources.load);

function satellitePath(satellite?: {DllName: string, Path: string}) {
	if (satellite)
		return path.join(satellite.Path, satellite.DllName);
}

async function findAssembly(assembly?: string) {
	if (assembly) {
		const parts = assembly.split(',').map(i => insensitive.String(i.trim()));
		const packages	= (await virtual_registry.value)['$RootKey$'].RuntimeConfiguration.dependentAssembly.bindingRedirection;
		for (const i of Object.values(packages) as Record<string, any>[]) {
			if (i.name && parts[0].compare(i.name) === 0)
				return i.codeBase;
		}
		log('no assembly' + assembly);
		return path.join(vsdir, 'Common7', 'IDE', 'PublicAssemblies', assembly + '.dll');
	}
}

async function getStringResource(x: xml.Element) {
	const t = x.firstText();
	if (t)
		return t;

	const packge 	= x.attributes.Package;
	const id		= x.attributes.ID;

	if (packge && id) {
		const packages	= (await virtual_registry.value)['$RootKey$'].Packages;
		const entry 	= packages[packge.toLowerCase()] ?? packages[packge.toUpperCase()];
		if (entry) {
			const codebase = entry.CodeBase ?? satellitePath(entry.SatelliteDll) ?? await findAssembly(entry.Assembly);
			if (codebase) {
				let result;
				if ((result = (await ResCache.get(codebase))?.getString(id)))
					return result;

				const parts = path.parse(codebase);
				let codebase2 = path.join(parts.dir, '1033', parts.base);
				if (!await fs.exists(codebase2))
					codebase2 = path.join(parts.dir, 'en', parts.name + '.resources' + parts.ext);
				if (!await fs.exists(codebase2) && parts.name.endsWith('UI'))
					codebase2 = path.join(parts.dir, parts.name.slice(0, -2) + parts.ext);

				if ((result = (await ResCache.get(codebase2))?.getString(id)))
					return result;

				log('no res' + codebase + packge + id);
			} else {
				log('no code' + packge + id);
			}
		} else {
			log('no entry' + packge + id);
		}
		return `${packge}.${id}`;
	}
}

//-----------------------------------------------------------------------------
//	Template
//-----------------------------------------------------------------------------

interface ProjectInterface {
	addFile(item: string): void;
}

export interface Template {
	name: 			string;
	id:				string;
	language: 		string;
	tags: 			string[];
	defaultName:	string;
	create(folder: string, projectname: string, target: ProjectInterface) : void;
}

const languageMap = insensitive.Record({
	VC:				'C++',
	CSHARP:			'C#',
	FSHARP:			'F#',
	VISUALBASIC:	'VB',
	CPP:			'C++',
});

const extMap : Record<string, string> = {
	'C++':	'vcxproj',
	'C#':	'csproj',
	'F#':	'fsproj',
	'VB':	'vbproj',
};


export class DotNetTemplate implements Template {
	constructor(
		public name: 		string,
		public id:			string,
		public language: 	string,
		public tags: 		string[]
	) {}

	get defaultName() { return this.id; }

	async create(folder: string, projectname: string, target: ProjectInterface) {
		const result = await new Promise<string>(
			(resolve, reject) => execFile('dotnet', ['new', this.id, '-o', folder, '-n', projectname, '--language', this.language],
			(error, stdout, stderr) => resolve(stdout)
		));
	
		target.addFile(path.join(folder, projectname + '.' + extMap[this.language]));
	}
}


function attr_number(x?: string) : number {
	return +(x ?? 0);
}
function attr_boolean(x?: string) : boolean {
	return x?.toLowerCase() == 'true';
}

function xml_text(x?: xml.Element) : string {
	return x?.firstText() ?? '';
}

function makeSafe(str: string) {
	return str.replace(/[^\w]/g, '');
}

export class VSTemplate implements Template {
	name!: 			string;
	id:				string;
	language: 		string	= '?';
	tags: 			string[] = [];
	defaultName: 	string;
	description!:	string;
	icon!:			string;
	platform	= '';

	constructor(public container: xml.Element, public filename: string) {
		const data	= container.elements.TemplateData.elements;

		this.id				= xml_text(data.TemplateID);
		this.defaultName	= xml_text(data.DefaultName);

		let	tag: string;
		if ((tag = xml_text(data.LanguageTag ?? data.ProjectType)))
			this.language = languageMap[tag] ?? tag;

		if ((tag = xml_text(data.PlatformTag)))
			this.tags.push(tag);

		if ((tag = xml_text(data.ProjectTypeTag)))
			this.tags.push(tag);
	}

	static async load(container: xml.Element, filename: string) {
		const r		= new VSTemplate(container, filename);
		const data	= container.elements.TemplateData.elements;
		r.name			= await getStringResource(data.Name);
		r.description	= await getStringResource(data.Description);
		r.icon			= await getStringResource(data.Icon);
		return r;
	}

	private fromManifest() {
		return this.container.name === 'VSTemplateHeader';
	}
	get header() {
		return this.container.elements.TemplateData;
	}

	async create(folder: string, projectname: string, to: ProjectInterface) {
		const source_dir= path.dirname(this.filename);
		const root		= this.fromManifest() ? (await XMLCache.get(this.filename))?.firstElement() : this.container;
		if (root?.name !== 'VSTemplate')
			return;
	
		const date 		= new Date();
		const publisher = process.env.USERNAME ?? 'unknown';

		const sdk = await Locations.windowsKits.value;
		const platform_versions = Object.keys(sdk.Platforms.entries.UAP);

		const xmlEncoder = new xml.EntityCreator();

		const substitutions : Record<string, string> = {
			projectname,
			defaultnamespace:			projectname,	//The root namespace of the current project.
			safeprojectname:			makeSafe(projectname),
			packageName:				this.name,
			machinename:				process.env.COMPUTERNAME??'',
			year:						date.getFullYear().toString(),
			time:						date.toLocaleString(),
			guid1:						crypto.randomUUID(),
			guid2:						crypto.randomUUID(),
			guid3:						crypto.randomUUID(),
			guid4:						crypto.randomUUID(),
			guid5:						crypto.randomUUID(),
			guid6:						crypto.randomUUID(),
			guid7:						crypto.randomUUID(),
			guid8:						crypto.randomUUID(),
			guid9:						crypto.randomUUID(),
			guid10:						crypto.randomUUID(),

			currentuiculturename:   	'en-US',	//TODO
		//	targetframeworkversion: 	'',
			targetplatformminversion:   platform_versions[0],
			targetplatformversion:  	platform_versions.at(-1)!,

		//	clrversion					Current version of the common language runtime (CLR).
		//	ext_*						Add the ext_ prefix to any parameter to refer to the variables of the parent template. For example, ext_safeprojectname.
		//	registeredorganization		The registry key value from HKLM\Software\Microsoft\Windows NT\CurrentVersion\RegisteredOrganization.
		//	targetframeworkversion		Current version of the target .NET Framework.
		//	specifiedsolutionname		The name of the solution. When "Place solution and project in the same directory" is unchecked, specifiedsolutionname has the solution name. When "create solution directory" is not checked, specifiedsolutionname is blank.
		//	webnamespace				The name of the current website. This parameter is used in the web form template to guarantee unique class names. If the website is at the root directory of the web server, this template parameter resolves to the root directory of the web server.

			XmlEscapedPublisher:					xmlEncoder.replace(publisher),
			XmlEscapedPublisherDistinguishedName:	xmlEncoder.replace(`CN=${publisher}`),
		};

		let   content	= root.elements.TemplateContent;

		//CustomParameters
		utils.eachIterable(content.elements.CustomParameters?.elements.CustomParameter, i =>
			substitutions[i.attributes.Name.slice(1, -1)] = replace(i.attributes.Value, substitutions)
		);

		if (!await fs.createDirectory(folder))
			return;

		const project 	= content.elements.Project;

		if (project)
			content = project;

		await Promise.all(Array.from(content.elements.ProjectItem, async item => {
			const source = item.firstText() ?? '';
			const target = item.attributes.TargetFileName
				? replace(item.attributes.TargetFileName, substitutions)
				: source;
			const target_filename = path.join(folder, target);

			if (attr_boolean(item.attributes.ReplaceParameters)) {
				const [data, encoding] = await fs.loadTextFileEncoding(path.join(source_dir, source));
				if (data) {
					const safeitemname = makeSafe(target);

					const data2 = replace(data, {
						fileinputname:		source,
						itemname:			target,
						safeitemname,
						safeitemrootname:	safeitemname,
						rootsafeitemname:	safeitemname,
						rootnamespace:		projectname + target.replace('\\', '.'),
						...substitutions
					});
					await fs.writeTextFile(target_filename, data2, encoding);
				}
			} else {
				try {
					await fs.copyFile(path.join(source_dir, source), target_filename);
				} catch (error: any) {
					log(error.toString());
				}
			}

			if (!project)
				to.addFile(target_filename);
			
		}));

		if (project) {
			const source = project.attributes.File;
			const project_filename = path.join(folder, projectname + path.extname(source));
			if (attr_boolean(project.attributes.ReplaceParameters)) {
				const data = await fs.loadTextFile(path.join(source_dir, source));
				await fs.writeTextFile(project_filename, replace(data, substitutions), 'utf8');
			} else {
				await fs.copyFile(path.join(source_dir, source), project_filename);
			}
			to.addFile(project_filename);
		}

	}
}

async function getDotNetTemplates(type: string) {
	const list = await new Promise<string>(
		(resolve, reject) => execFile('dotnet', ['new', 'list', '--type', type],
		(error, stdout, stderr) => resolve(stdout)
	));

	const lines = list.split('\n').slice(4);
	const dntemplates = lines.filter(line => line.trim() !== '').map(line => {
		const [name, shortName, languages, tags] = line.split('  ').filter(Boolean);
		return {
			name:		name.trim(),
			id:			shortName.trim(),
			languages:	languages.trim().split(',').map(lang => lang[0] == '[' ? lang.slice(1,-1) : lang),
			tags:		tags ? tags.trim().split('/').map(tag => tag.trim()) : []
		};
	});

	return dntemplates.reduce((acc, i)=> {
		i.languages.forEach(lang => acc.push(new DotNetTemplate(i.name, i.id, lang, i.tags)));
		return acc;
	}, [] as Template[]);
}

async function getManifestTemplates(templates: Record<string, Template[]>, root: string) {
	await fs.readDirectory(root).then(dir => utils.asyncMap(fs.files(dir, '*.vstman'),
		filename => fs.loadTextFile(path.join(root, filename)).then(async content =>
			utils.asyncMap(xml.parse(content).firstElement()?.elements.VSTemplateContainer, async c => {
				const filename = path.join(root, c.elements.RelativePathOnDisk.firstText() ?? '', c.elements.TemplateFileName.firstText() ?? '');
				const t = await VSTemplate.load(c.elements.VSTemplateHeader, filename);
				const type = c.attributes.TemplateType??'unknown';
				(templates[type] ??= []).push(t);
			})
		)
	));
}

export const templates = new utils.Lazy(async () => {
	const templates: Record<string, Template[]> = {};
	templates.Project		= [];
	templates.ProjectGroup	= [];
	templates.Item			= [];

	await utils.parallel(
		async () => templates.DotNetProject = await getDotNetTemplates('project'),
		async () => templates.DotNetItem	= await getDotNetTemplates('item'),
		async () => getManifestTemplates(templates, path.join(vsdir, 'Common7','IDE','ProjectTemplates')),
		async () => getManifestTemplates(templates, path.join(vsdir, 'Common7','IDE','ItemTemplates')),
	);

	return templates;
});
