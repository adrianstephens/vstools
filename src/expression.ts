
import * as vscode from "vscode";
import * as fs from './fs';
import * as path from "path";
import {getKey} from './registry';
import {firstOf, lastOf, replace, replace_back, async_replace_back} from './utils';

type StringFunction = (...params: string[])=>any;

function IsNullOrWhiteSpace(value?: string) 	{ return !value || value.trim().length === 0 || value.replace(/\s/g, "").length === 0; }
function IsNullOrEmpty(value?: string)			{ return !value; }
function fix_quotes(value: string)				{ return value.replace(/^\s*'?|'?\s*$/g, ''); }

class Version {
	constructor(public major = 0, public minor = 0) {}
	toString() { return `${this.major}.${this.minor}`; }
	compare(b: Version) { return this.major === b.major ? this.minor - b.minor : this.major - b.major; }

	static parse(v?: string) {
		if (v) {
			const parts = v.split('.');
			return new Version(+parts[0], parts.length > 1 ? +parts[1] : 0);
		}
	}
}

function version_compare(a: string, b: string) {
	a = a.substring(a.startsWith('v') || a.startsWith('v') ? 1 : 0, firstOf(a, '+-'));
	b = b.substring(b.startsWith('v') || b.startsWith('v') ? 1 : 0, firstOf(b, '+-'));
	const a1 = a.split('.');
	const b1 = b.split('.');

	const n = Math.min(a1.length, b1.length);
	for (let i = 0; i < n; i++) {
		const x = parseInt(a1[i], 10);
		const y = parseInt(b1[i], 10);
		if (x < y) return -1;
		if (x > y) return 1;
	}
	return a1.length - b1.length;
/*
	const re = /v?(\d+\.)+(\d+)/i
	if (a.startsWith('v') || a.startsWith('v'))
		a = a.substring(1)
	if (b.startsWith('v') || b.startsWith('v'))
		b = b.substring(1)
*/
}

function escape(unescapedString: string) { 
	[...unescapedString].map(char => {
		const code = char.charCodeAt(0);
		return code >= 32 && code <= 126 ? char : `%${code.toString(16).padStart(2, '0').toUpperCase()}`;
	}).join('');
}

function unescapeAll(escapedString: string, trim = false): string {
	if (trim)
		escapedString = escapedString.trim();
	return replace(escapedString, /%([0-9A-Fa-f][0-9A-Fa-f])/g, m => String.fromCharCode(parseInt(m[1], 16)));
}

function getHashCode(s: string) {
	let hash1 = (5381 << 16) + 5381;
	let hash2 = hash1;

	const src = [...s].map(char => char.charCodeAt(0));
	for (let i = 0; i < src.length; i += 4) {
		hash1 = ((hash1 << 5) + hash1 + (hash1 >> 27)) ^ (src[i + 0] + (src[1 + 1] << 16));
		if (i + 2 < src.length)
			hash2 = ((hash2 << 5) + hash2 + (hash2 >> 27)) ^ (src[i + 2] + (src[1 + 3] << 16));
	}

	return hash1 + (hash2 * 1566083941);
}

class StringFunctions {
	[key:string]: any;//StringFunction;
	constructor(private value: string) {}

	public IndexOf(...params: string[]) {
		switch (params.length) {
			default: return this.value.indexOf(params[0]);
			case 2: return this.value.indexOf(params[0], +params[1]);
			case 3: return this.value.substring(0, +params[1] + +params[2]).indexOf(params[0], +params[1]);
		}
	}
	public Substring(...params: string[]) 	{ return params.length == 1 ? this.value.substring(+params[0]) : this.value.substring(+params[0], +params[0] + +params[1]); }
	public CompareTo(...params: string[]) 	{ return this.value < params[0] ? -1 : this.value > params[0] ? 1 : 0; }
	public EndsWith(...params: string[]) 	{ return this.value.endsWith(params[0]); }
	public IndexOfAny(...params: string[]) {
		switch (params.length) {
			default: return firstOf(this.value, params[0]);
			case 2: return firstOf(this.value.substring(+params[1]), params[0]) + +params[1];
			case 3: return firstOf(this.value.substring(+params[1], +params[1] + +params[2]), params[0]) + +params[1];
		}
	}
	public IsNullOrEmpty() 		{ return !this.value; }
	public IsNullOrWhiteSpace() { return IsNullOrWhiteSpace(this.value); }
	public LastIndexOf(...params: string[]) {
		switch (params.length) {
			default: return this.value.lastIndexOf(params[0]);
			case 2: return this.value.lastIndexOf(params[0], +params[1]);
			case 3: return this.value.substring(+params[1] - +params[2]).lastIndexOf(params[0], +params[1]);
		}
	}
	public LastIndexOfAny(...params: string[]) {
		switch (params.length) {
			default: return lastOf(this.value, params[0]);
			case 2: return lastOf(this.value.substring(0, +params[1]), params[0]);
			case 3: {
				const start = Math.max(+params[1] - +params[2], 0);
				return lastOf(this.value.substring(start, +params[1]), params[0]) + start;
			}
		}
	}
	public PadLeft(len: number, char: string = ' ') 	{ return this.value.padStart(len, char); }
	public PadRight(len: number, char: string = ' ')	{ return this.value.padEnd(len, char); }
	public Remove(a:string, b?:string) 		{ return this.value.substring(0, +a) + (b ? this.value.substring(+a + +b) : ""); }
	public Replace(from:string, to:string) 	{ return this.value.replace(from, to); }
	public StartsWith(param: string)		{ return this.value.startsWith(param); }
	public ToLower() 						{ return this.value.toLowerCase(); }
	public ToUpper() 						{ return this.value.toUpperCase(); }
	public Trim() 							{ return this.value.trim(); }
	public TrimEnd() 						{ return this.value.trimEnd(); }
	public TrimStart() 						{ return this.value.trimStart(); }
}

class StaticFunctions {
	[key:string]: StringFunction;
}

//const static_classes : Record<string, typeof StaticFunctions> = {};
const static_classes : Record<string, Record<string, StringFunction>> = {};
function register_statics(name: string, obj: typeof StaticFunctions) {
	const proto = obj.prototype;
	Object.getOwnPropertyNames(proto).forEach(k => {
		proto[k.toUpperCase()] = proto[k];
	});

	//const obj2 = Object.fromEntries(Object.getOwnPropertyNames(obj.prototype).map(k => [k.toUpperCase(), obj.prototype[k]]));
	static_classes[name.toUpperCase()] = proto;
//	static_classes[name] = obj;
}
	
class Reflection_Assembly extends StaticFunctions {
	static {register_statics('Reflection.Assembly', this); }
	public LoadFile(...params: string[]) {}
}

class StringStatic extends StaticFunctions {
	static {register_statics('String', this); }
	public Concat(param0: string, param1: string) 	{ return param0 + param1; }
	public Copy(param: string) 						{ return param; }
	public IsNullOrEmpty(param: string) 			{ return param.length === 0; }
	public IsNullOrWhiteSpace(param: string) 		{ return IsNullOrWhiteSpace(param); }
	public new(param: string) 						{ return param; }
	public Format(format:string, ...params: string[]) {
		//{index[,alignment][:formatString]}
		const re = /{(\d+)(,[+-]?\d+)?(:\w+)}/g;
		let m: RegExpExecArray | null;
		let result = '';
		let i = 0;
		while ((m = re.exec(format))) {
			let param		= params[parseInt(m[1], 10)];
			if (m[3]) {
				//const format 	= m[3].substring(1);
			}
			if (m[2]) {
				const alignment = parseInt(m[2].substring(2), 10);
				param = alignment < 0 ? param.padEnd(-alignment, ' ') : param.padStart(alignment, ' ');
			}
			result += params[0].substring(i, re.lastIndex) + param;
			i = re.lastIndex;
		}
		return result + params[0].substring(i);
	}
}

class Convert extends StaticFunctions {
	static {register_statics('Convert', this); }//static_classes['Convert'] = this; }
	public ToUInt32(...params: string[])	{ return 'ToUInt32'; }
}
class Globalization_CultureInfo extends StaticFunctions {
	static {register_statics('Globalization.CultureInfo', this); }
	public CurrentUICulture(...params: string[]) { return 'CurrentUICulture'; }
}
class Guid extends StaticFunctions {
	static {register_statics('Guid', this); }
	public NewGuid(...params: string[]) 	{ return 'NewGuid'; }
}
class Runtime_InteropServices_RuntimeInformation extends StaticFunctions {
	static {register_statics('Runtime.InteropServices.RuntimeInformation', this); }
	public ProcessArchitecture(...params: string[]) { return 'ProcessArchitecture'; }
}
class Text_RegularExpressions_Regex extends StaticFunctions {
	static {register_statics('Text.RegularExpressions.Regex', this); }
	public Match(...params: string[]) 		{ return 'Match'; }
	public Replace(...params: string[]) 	{ return 'Replace'; }
	public Split(...params: string[])		{ return 'Split'; }
}

class VersionStatic extends StaticFunctions {
	static {register_statics('Version', this); }
	public New(param: string)			{ return Version.parse(param); }
	public Parse(param: string) 		{ return Version.parse(param); }
}

class Environment extends StaticFunctions {
	static {
		register_statics('Environment', this);
	}
//	public CommandLine(...params: string[])			{ return 'CommandLine'; }
	public ExpandEnvironmentVariables(s : string)	{ return replace(s, /%(.*?)%/g, m => process.env[m[1]] || ''); }
	public GetEnvironmentVariable(s: string)		{ return process.env[s]; }
	public GetEnvironmentVariables()				{ return process.env; }
	public GetFolderPath(folder: string) {
		const env = process.env;
		switch (folder.split('.')[1]) {//SpecialFolder.xxx
			default:	return '??';
			case 'AdminTools':             return `${env.USERPROFILE}\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Administrative Tools`;
			case 'ApplicationData':        return `${env.APPDATA}`;
			case 'CDBurning':              return `${env.USERPROFILE}\\AppData\\Local\\Microsoft\\Windows\\Burn\\Burn`;
			case 'CommonAdminTools':       return `${env.ALLUSERSPROFILE}\\Microsoft\\Windows\\Start Menu\\Programs\\Administrative Tools`;
			case 'CommonApplicationData':  return `${env.ALLUSERSPROFILE}`;
			case 'CommonDesktopDirectory': return `${env.PUBLIC}\\Desktop`;
			case 'CommonDocuments':        return `${env.PUBLIC}\\Documents`;
			case 'CommonMusic':            return `${env.PUBLIC}\\Music`;
			case 'CommonPictures':         return `${env.PUBLIC}\\Pictures`;
			case 'CommonProgramFiles':     return `${env.ProgramFiles}\\Common Files`;
			case 'CommonProgramFilesX86':  return `${env['ProgramFiles(x86)']}\\Common Files`;
			case 'CommonPrograms':         return `${env.ALLUSERSPROFILE}\\Microsoft\\Windows\\Start Menu\\Programs`;
			case 'CommonStartMenu':        return `${env.ALLUSERSPROFILE}\\Microsoft\\Windows\\Start Menu`;
			case 'CommonStartup':          return `${env.ALLUSERSPROFILE}\\Microsoft\\Windows\\Start Menu\\Programs\\Startup`;
			case 'CommonTemplates':        return `${env.ALLUSERSPROFILE}\\Microsoft\\Windows\\Templates`;
			case 'CommonVideos':           return `${env.PUBLIC}\\Videos`;
			case 'Cookies':                return `${env.USERPROFILE}\\AppData\\Roaming\\Microsoft\\Windows\\Cookies`;
			case 'Desktop':                return `${env.USERPROFILE}\\Desktop`;
			case 'Favorites':              return `${env.USERPROFILE}\\Favorites`;
			case 'Fonts':                  return `${env.WINDIR}\\Fonts`;
			case 'History':                return `${env.USERPROFILE}\\AppData\\Local\\Microsoft\\Windows\\History`;
			case 'InternetCache':          return `${env.USERPROFILE}\\AppData\\Local\\Microsoft\\Windows\\INetCache`;
			case 'LocalApplicationData':   return `${env.LOCALAPPDATA}`;
			case 'MyDocuments':            return `${env.USERPROFILE}\\Documents`;
			case 'MyMusic':                return `${env.USERPROFILE}\\Music`;
			case 'MyPictures':             return `${env.USERPROFILE}\\Pictures`;
			case 'MyVideos':               return `${env.USERPROFILE}\\Videos`;
			case 'ProgramFiles':           return `${env.ProgramFiles}`;
			case 'ProgramFilesX86':        return `${env['ProgramFiles(x86)']}`;
			case 'Programs':               return `${env.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs`;
			case 'Recent':                 return `${env.USERPROFILE}\\AppData\\Roaming\\Microsoft\\Windows\\Recent`;
			case 'SendTo':                 return `${env.USERPROFILE}\\AppData\\Roaming\\Microsoft\\Windows\\SendTo`;
			case 'StartMenu':              return `${env.APPDATA}\\Microsoft\\Windows\\Start Menu`;
			case 'Startup':                return `${env.APPDATA}\\Microsoft\\Windows\\Start Menu\\Programs\\Startup`;
			case 'System':                 return `${env.WINDIR}\\System32`;
			case 'SystemX86':              return `${env.WINDIR}\\SysWOW64`;
			case 'Templates':              return `${env.APPDATA}\\Microsoft\\Windows\\Templates`;
			case 'UserProfile':            return `${env.USERPROFILE}`;
			case 'Windows':                return `${env.WINDIR}`;
		}
	}
//	public GetLogicalDrives(...params: string[])				{ return 'GetLogicalDrives'; }
//	public Is64BitOperatingSystem(...params: string[])			{ return 'Is64BitOperatingSystem'; }
	public Is64BitProcess(...params: string[])					{ return true; }
//	public MachineName(...params: string[])					{ return 'MachineName'; }
//	public NewLine(...params: string[])						{ return 'NewLine'; }
//	public OSVersion(...params: string[])						{ return 'OSVersion'; }
//	public ProcessorCount(...params: string[])					{ return 'ProcessorCount'; }
//	public StackTrace(...params: string[])						{ return 'StackTrace'; }
//	public SystemDirectory(...params: string[])				{ return 'SystemDirectory'; }
//	public SystemPageSize(...params: string[])					{ return 'SystemPageSize'; }
//	public TickCount(...params: string[])						{ return 'TickCount'; }
//	public UserDomainName(...params: string[])					{ return 'UserDomainName'; }
//	public UserInteractive(...params: string[])				{ return 'UserInteractive'; }
//	public UserName(...params: string[])						{ return 'UserName'; }
//	public Version(...params: string[])						{ return 'Version'; }
//	public WorkingSet(...params: string[])						{ return 'WorkingSet'; }
}

class IO_Directory extends StaticFunctions {
	static { register_statics('IO.Directory', this); }
	public GetDirectories(dir:string, pattern:string)	{ return fs.search(dir, pattern, undefined, vscode.FileType.Directory); }
	public GetFiles(dir:string, pattern:string)			{ return fs.search(dir, pattern, undefined, vscode.FileType.File); }
//	public GetLastAccessTime(...params: string[])		{ return 'GetLastAccessTime'; }
	public GetLastWriteTime(a: string)					{ return fs.getStat(a).then(stat => stat?.mtime); }
	public GetParent(a: string)							{ return path.dirname(a); }
}
		
class IO_File extends StaticFunctions {
	static { register_statics('IO.File', this); }
	public Exists(a: string)							{ return fs.exists(a); }
	public GetAttributes(a: string)						{ return fs.getStat(a); }
	public GetCreationTime(a: string)					{ return fs.getStat(a).then(stat => stat?.ctime); }
	public GetLastAccessTime(a: string)					{ return fs.getStat(a).then(stat => stat?.mtime); }
	public GetLastWriteTime(a: string)					{ return fs.getStat(a).then(stat => stat?.mtime); }
	public ReadAllText(a: string)						{ return fs.loadTextFile(a); }
}

class IO_Path extends StaticFunctions {
	static { register_statics('IO.Path', this); }
	public ChangeExtension(a: string, b: string)	{ const parsed = path.parse(a); parsed.ext = b; return path.format(parsed); }
	public Combine(...params: string[])				{ return path.join(...params); }
	public GetDirectoryName(a: string)				{ return path.dirname(a); }
	public GetExtension(a: string)					{ return path.extname(a); }
	public GetFileName(a: string)					{ return path.basename(a); }
	public GetFileNameWithoutExtension(a: string)	{ return path.parse(a).name; }
	public GetFullPath(a: string, b?:string)		{ return path.resolve(b ? b : process.cwd(), a); }
	public GetPathRoot(a: string)					{ return path.parse(a).root; }
	public IsPathRooted(a: string)					{ return !!path.parse(a).root; }
}

//class OperatingSystem extends StaticFunctions {
//	static { register_statics('OperatingSystem', this); }
//	public IsOSPlatform(...params: string[])					{ return 'IsOSPlatform'; }
//	public IsOSPlatformVersionAtLeast(...params: string[])		{ return 'IsOSPlatformVersionAtLeast'; }
//	public IsLinux(...params: string[])						{ return 'IsLinux'; }
//	public IsFreeBSD(...params: string[])						{ return 'IsFreeBSD'; }
//	public IsFreeBSDVersionAtLeast(...params: string[])		{ return 'IsFreeBSDVersionAtLeast'; }
//	public IsMacOS(...params: string[])						{ return 'IsMacOS'; }
//	public IsMacOSVersionAtLeast(...params: string[])			{ return 'IsMacOSVersionAtLeast'; }
//	public IsWindows(...params: string[])						{ return 'IsWindows'; }
//	public IsWindowsVersionAtLeast(...params: string[])		{ return 'IsWindowsVersionAtLeast'; }
//}

class MSBuild extends StaticFunctions {
	static { register_statics('MSBuild', this); }
	public Add(a:string, b:string)							{ return +a + +b; }
	public Subtract(a:string, b:string)						{ return +a - +b; }
	public Multiply(a:string, b:string)						{ return +a * +b; }
	public Divide(a:string, b:string)					 	{ return +a / +b; }
	public Modulo(a:string, b:string)					 	{ return +a % +b; }
	public BitwiseOr(a:string, b:string)					{ return +a | +b; }
	public BitwiseAnd(a:string, b:string)				 	{ return +a & +b; }
	public BitwiseXor(a:string, b:string)				 	{ return +a ^ +b; }
	public BitwiseNot(a:string, b:string)				 	{ return ~+a; }
	public EnsureTrailingSlash(a: string)					{ return a && !a.endsWith(path.sep) ? a + path.sep : a; }
	public MakeRelative(a:string, b:string)					{ return path.relative(a, b); }
	public ValueOrDefault(a:string, b:string)			 	{ return a || b ; }
	public VersionEquals(a:string, b:string)				{ return version_compare(a, b) === 0; }
	public VersionGreaterThan(a:string, b:string)		 	{ return version_compare(a, b) > 0; }
	public VersionGreaterThanOrEquals(a:string, b:string) 	{ return version_compare(a, b) >= 0; }
	public VersionLessThan(a:string, b:string)				{ return version_compare(a, b) < 0; }
	public VersionLessThanOrEquals(a:string, b:string)		{ return version_compare(a, b) <= 0; }
	public VersionNotEquals(a:string, b:string)				{ return version_compare(a, b) !== 0; }
//	//TBD
	public DoesTaskHostExist(...params: string[])			{ return 'DoesTaskHostExist'; }
//	public GetRegistryValue(...params: string[])			{ return 'GetRegistryValue'; }
	public async GetRegistryValueFromView(key:string, item:string, defaultValue:string, ...views: string[]) {
		if (views.length == 0)
			return getKey(key).items[item].catch(()=>'');
		for (const view of views) {
			const found = await getKey(key, view == 'RegistryView.Registry32' ? '32' : '64').values[item].catch(()=>'');
			if (found)
				return found;
		}
	}
	public StableStringHash(a: string)						{ return getHashCode(a); }
//	public TargetFramework(...params: string[])				{ return 'TargetFramework'; }
//	public TargetPlatform(...params: string[])				{ return 'TargetPlatform'; }
//	public GetPathOfFileAbove(...params: string[])			{ return 'GetPathOfFileAbove'; }
	public GetDirectoryNameOfFileAbove(...params: string[])	{ return 'GetDirectoryNameOfFileAbove'; }
//	public IsOsPlatform(...params: string[])				{ return 'IsOsPlatform'; }
//	public IsOSUnixLike(...params: string[])				{ return 'IsOSUnixLike'; }
	public NormalizePath(...params: string[])				{ return 'NormalizePath'; }
	public NormalizeDirectory(...params: string[])			{ return 'NormalizeDirectory'; }
	public Escape(unescapedString: string)					{ return escape(unescapedString); }
	public Unescape(escapedString: string)					{ return unescapeAll(escapedString); }
//	public ConvertToBase64(...params: string[])				{ return 'ConvertToBase64'; }
//	public ConvertFromBase64(...params: string[])			{ return 'ConvertFromBase64'; }

	public AreFeaturesEnabled(...params: string[])			{ return 'AreFeaturesEnabled'; }

	public GetMSBuildExtensionsPath()		{ return path.join(this.GetVsInstallRoot(), 'MSBuild'); }
	public GetMSBuildSDKsPath()				{ return process.env.MSBuildSDKsPath ?? path.join(this.GetVsInstallRoot(), "MSBuild", "Sdks"); }
	public GetProgramFiles32()				{ return process.env["ProgramFiles(x86)"] ?? ''; }
	public GetToolsDirectory32()			{ return path.join(this.GetVsInstallRoot(), 'MSBuild', 'Current', 'Bin'); }
	public GetToolsDirectory64()			{ return path.join(this.GetVsInstallRoot(), 'MSBuild', 'Current', 'Bin', 'amd64'); }
	public GetCurrentToolsDirectory()		{ return this.GetToolsDirectory64(); }
	public GetVsInstallRoot()				{ return process.env.vsdir || ''; }
	public IsRunningFromVisualStudio()		{ return false; }
}


interface VisualStudioInstance {
	Name: string;
	Path: string;
	Version: Version;
}

const s_vsInstallFolders: Record<string, string[]> = {};
const s_cachedTargetPlatformReferences : Record<string, VisualStudioInstance[]> = {};

class Helper {
	static GetInstances() : VisualStudioInstance[] {
		return [];
	}
	static GetFoldersInVSInstalls(minVersion?: Version, maxVersion?: Version, subFolder?: string) {
		const key	= `${minVersion}-${maxVersion}`;
		let folders = s_vsInstallFolders[key];
		if (!folders) {
			folders = Helper.GetInstances()
				.filter(i => (!minVersion || i.Version.compare(minVersion) >= 0) && (!maxVersion || i.Version.compare(maxVersion) < 0))
				.sort((a, b) => a.Version.compare(b.Version))
				.map(i => i.Path);
			s_vsInstallFolders[key] = folders;
		}

		return subFolder ? folders.map(i => path.join(i, subFolder)) : folders;
	}
}

class Microsoft_Build_Utilities_ToolLocationHelper extends StaticFunctions {
	static { register_statics('Microsoft.Build.Utilities.ToolLocationHelper', this); }

	public async FindRootFolderWhereAllFilesExist(possibleRoots: string, relativeFilePaths: string)	{
		const files = relativeFilePaths.split(';');
		for (const root of possibleRoots.split(';')) {
			const exist = await Promise.all(files.map(async file => fs.exists(path.join(root, file))));
			if (exist.every(i => i))
				return root;
		}
		return '';
	}
	public GetFoldersInVSInstallsAsString(minVersionString?: string, maxVersionString?: string, subFolder?: string) { 
		const folders = Helper.GetFoldersInVSInstalls(Version.parse(minVersionString), Version.parse(maxVersionString), subFolder);
		return folders.length ? folders.join(';') : '';
	}
/*
	public GetLatestSDKTargetPlatformVersion(sdkIdentifier: string, sdkVersion: string, sdkRoots: string[]) {
		const platformMonikerList = Helper.GetPlatformsForSDK(sdkIdentifier, new Version(sdkVersion), sdkRoots, null);

		const availablePlatformVersions: Version[] = [];
		for (const moniker of platformMonikerList) {
			const v = new Version(moniker);
			if (v.major)
				availablePlatformVersions.push(v);
		}

		return availablePlatformVersions.length
			? availablePlatformVersions.sort((a, b) => b.compare(a))[0].toString()
			: '';
	}

	public GetPlatformSDKDisplayName(targetPlatformIdentifier:string, targetPlatformVersion:string, diskRoots:string, registryRoot:string) {
		const targetPlatform = GetMatchingPlatformSDK(targetPlatformIdentifier, targetPlatformVersion, diskRoots, null, registryRoot);
		return targetPlatform?.DisplayName ?? GenerateDefaultSDKDisplayName(targetPlatformIdentifier, targetPlatformVersion);
	}

	public GetTargetPlatformReferences(sdkIdentifier:string, sdkVersion:string, targetPlatformIdentifier:string, targetPlatformMinVersion:string, targetPlatformVersion:string, diskRoots:string, registryRoot:string) {
		const cacheKey = [sdkIdentifier, sdkVersion, targetPlatformIdentifier, targetPlatformMinVersion, targetPlatformVersion, diskRoots, registryRoot].join('|');

		let targetPlatformReferences = s_cachedTargetPlatformReferences[cacheKey];
		if (!targetPlatformReferences) {
			targetPlatformReferences = !sdkIdentifier && !sdkVersion
				? GetLegacyTargetPlatformReferences(targetPlatformIdentifier, targetPlatformVersion, diskRoots, registryRoot)
				: GetTargetPlatformReferencesFromManifest(sdkIdentifier, sdkVersion, targetPlatformIdentifier, targetPlatformMinVersion, targetPlatformVersion, diskRoots, registryRoot);

			s_cachedTargetPlatformReferences[cacheKey] = targetPlatformReferences;
		}
		return targetPlatformReferences;
	}

	public async GetPathToStandardLibraries(targetFrameworkIdentifier:string, targetFrameworkVersion:string, targetFrameworkProfile:string) {
		const referenceAssemblyDirectories = GetPathToReferenceAssemblies(targetFrameworkIdentifier, targetFrameworkVersion, targetFrameworkProfile);
		for (const referenceAssemblyDirectory of referenceAssemblyDirectories) {
			if (await exists(path.join(referenceAssemblyDirectory, "mscorlib.dll")))
				// We found the framework reference assembly directory with mscorlib in it that's our standard lib path, so return it, with no trailing slash.
				return EnsureNoTrailingSlash(referenceAssemblyDirectory);
		}
		return '';
	}

	public GetPlatformSDKLocation(targetPlatformIdentifier:string, targetPlatformVersion:string, diskRoots:string[], registryRoot:string) {
		const targetPlatform = GetMatchingPlatformSDK(targetPlatformIdentifier, targetPlatformVersion, diskRoots, null, registryRoot);
		return targetPlatform?.Path ?? '';
	}
*/
}

class Microsoft_VisualStudio_Telemetry_TelemetryService extends StaticFunctions {
	static { register_statics('Microsoft.VisualStudio.Telemetry.TelemetryService', this); }
	public DefaultSession(...params: string[])	{ return 'DefaultSession'; }
}

class Security_Principal_WindowsIdentity extends StaticFunctions {
	static { register_statics('Security.Principal.WindowsIdentity', this); }
	public GetCurrent(...params: string[])	{ return 'GetCurrent'; }
}

function get_params(value: string, start = 0) : [number, string[]] {
	const params: string[] = [];
	let i		= start;
	let depth	= 1;
	while (depth && i < value.length) {
		switch (value.charAt(i++)) {
			case '(':
				depth++;
				break;
			case ')':
				if (--depth == 0)
					params.push(fix_quotes(value.substring(start, i - 1)));
				break;
			case ',':
				if (depth == 1) {
					params.push(fix_quotes(value.substring(start, i - 1)));
					start = i;
				}
				break;
		}
	}
	return [i, params];
}

export async function substitute(value: string, re: RegExp, properties: Record<string, string>, leave_undefined = false): Promise<string> {
	return async_replace_back(value, re, async (m: RegExpExecArray, right:string) => {
		let replace = m[1].startsWith('[') ? m[1] : properties[m[1].toUpperCase()];
		
		if (!replace) {
			//console.log(`no substitute for ${m[1]}`);
			if (leave_undefined)
				return m[0] + right;
			replace = '';
		}

		if (m[2] !== ')') {
			const [close, params] = get_params(right);
			let result;

			if (m[2].startsWith('::')) {
				const func = m[2].slice(2, -1);//.substring(2, m[2].length - 1);
				replace = replace.slice(replace.startsWith('[System.') ? 8 : 1, -1);
				try {
					result = await static_classes[replace.toUpperCase()][func.toUpperCase()](...params);
				} catch (error) {
					return `unknown_${replace}::${func}()`;
				}
			} else {
				const func = m[2].substring(1, m[2].length - 1);
				try {
					result = new StringFunctions(replace)[func](params);
				} catch (error) {
					return `unknown_${func}(${replace})`;
				}
			}

			const re2 = /^\.(\w+)/g;
			re2.lastIndex = close;

			let m2: RegExpExecArray | null;
			while ((m2 = re2.exec(right))) {
				if (right[re2.lastIndex] == '(') {
					//function
					const func = m[2].slice(1, -1);
					try {
						const [close, params] = get_params(right);
						result 			= await result[func](params);
						re2.lastIndex	= close;
					} catch (error) {
						return `unknown_${func}()`;
					}

				} else {
					//field
					result	= result[m2[1]];
				}
			}

			replace = result == undefined ? '' : result.toString();
			right	= right.substring(close + 1);//+1 for substitution closing )
		}
		return replace + right;
	});
}


export async function substitute_old(value: string, re: RegExp, properties: Record<string, string>, leave_undefined = false): Promise<string> {
	const i = re.lastIndex;
	const m = re.exec(value);
	if (m) {
		const end	= re.lastIndex;
		let right	= await substitute_old(value, re, properties, leave_undefined);
		let replace = m[1].startsWith('[') ? m[1] : properties[m[1].toUpperCase()];

		if (!replace) {
			//console.log(`no substitute for ${m[1]}`);
			if (leave_undefined)
				return value.substring(i, end) + right;
			replace = '';
		}

		if (m[2] !== ')') {
			const [close, params] = get_params(right);

			let result: any;

			if (m[2].startsWith('::')) {
				const func = m[2].slice(2, -1);//.substring(2, m[2].length - 1);
				replace = replace.slice(replace.startsWith('[System.') ? 8 : 1, -1);
				try {
					result = await static_classes[replace.toUpperCase()][func.toUpperCase()](...params);
				} catch (error) {
					return `unknown_${replace}::${func}()`;
				}
			} else {
				const func = m[2].substring(1, m[2].length - 1);
				try {
					result = new StringFunctions(replace)[func](params);
				} catch (error) {
					return `unknown_${func}(${replace})`;
				}
			}

			const re2 = /^\.(\w+)/g;
			re2.lastIndex = close;

			let m2: RegExpExecArray | null;
			while ((m2 = re2.exec(right))) {
				if (right[re2.lastIndex] == '(') {
					//function
					const func = m[2].slice(1, -1);
					try {
						const [close, params] = get_params(right);
						result 			= await result[func](params);
						re2.lastIndex	= close;
					} catch (error) {
						return `unknown_${func}()`;
					}

				} else {
					//field
					result	= result[m2[1]];
				}
			}

			replace = result == undefined ? '' : result.toString();

/*
			if (m[2].startsWith('::')) {
				const func = m[2].substring(2, m[2].length - 1);
				replace = replace.substring(replace.startsWith('[System.') ? 8 : 1, replace.length - 1);
				try {
					let result = await static_classes[replace.toUpperCase()][func.toUpperCase()](...params);
					if (right.substring(close).startsWith('.')) {
						const field = right.substring(close + 1);
						result = result[field];
					}
					replace = result.toString();
				} catch (error) {
					return `unknown_${replace}::${func}()`;
				}
			} else {
				const func = m[2].substring(1, m[2].length - 1);
				try {
					replace = (new StringFunctions(replace))[func](params);
				} catch (error) {
					return `unknown_${func}(${replace})`;
				}
			}
				
*/
			right	= right.substring(close + 1);//+1 for substitution closing )
		}
		return value.substring(i, m.index) + replace + right;
	}
	re.lastIndex = value.length;
	return value.substring(i);
}

function get_boolean(value: any) : boolean {
	return value && (typeof(value) != 'string' || value.toLowerCase() !== 'false');
}

function has_trailing_slash(value: string) {
	const last = value.charAt(value.length - 1);
	return last == '/' || last == '\\';
}

class ExpressionParser {
	re 		= /\s*('.*?'|==|!=|<=|>=|[<>!()]|And|Or|Exists\(|HasTrailingSlash\()/iy;
	next_token : string | undefined;

	constructor(public text: string) {
	}

	get_token0() : string | undefined {
		const m = this.re.exec(this.text);
		if (m)
			return m[1];
		this.re.lastIndex = this.text.length;
	}
	get_token() : string | undefined {
		if (this.next_token) {
			const result = this.next_token;
			this.next_token = undefined;
			return result;
		}
		return this.get_token0();
	}
	
	consume_token() {
		this.next_token = undefined;
	}
	
	peek_token() : string | undefined {
		if (!this.next_token)
			this.next_token = this.get_token0();
		return this.next_token;
	}


	Evaluate0() : any {
		let a = this.get_token();
		switch (a) {	
			case '(': {
				a = this.Evaluate();
				return this.get_token() === ')' ? a : undefined;
			}
			case 'Exists(': {
				a = this.Evaluate();
				return this.get_token() === ')' ? fs.exists(a || "") : undefined;
			}
			case 'HasTrailingSlash(': {
				a = this.Evaluate();
				return this.get_token() === ')' ? has_trailing_slash(a ?? "") : undefined;
			}
			default: return a ? fix_quotes(a) : a;
		}
	}

	Evaluate1() : any {
		const a = this.Evaluate0();
		if (a === undefined)
			return undefined;
		const token = this.get_token();
		switch (token) {
			case '==':	return a === this.Evaluate0();
			case '!=':	return a !== this.Evaluate0();
			case '<=':	return +a <= +this.Evaluate0();
			case '>=':	return +a >= +this.Evaluate0();
			case '<':	return +a < +this.Evaluate0();
			case '>':	return +a > +this.Evaluate0();
			default: this.next_token = token; return a;
		}
	}

	Evaluate2() : any {
		let a = this.Evaluate1();
		while (a !== undefined && this.peek_token()?.toLowerCase() == 'and') {
			this.consume_token();
			const b = this.Evaluate1();
			a = get_boolean(a) && get_boolean(b);
		}
		return a;
	}

	Evaluate3() : any {
		let a = this.Evaluate2();
		while (a !== undefined && this.peek_token()?.toLowerCase() == 'or') {
			this.consume_token();
			const b = this.Evaluate2();
			a = get_boolean(a) || get_boolean(b);
		}
		return a;
	}

	Evaluate() : any {
		return this.Evaluate3();
	}
}

export function Evaluate(value: string) {
	return new ExpressionParser(value).Evaluate();
}
