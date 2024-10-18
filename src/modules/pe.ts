import * as binary from "./binary";
import * as fs from "./fs";

function stringCode(s: string) {
	let r = 0;
	for (let i = 0; i < s.length; i++)
		r += s.charCodeAt(i) << (i * 8);
	return r;
}

//-----------------------------------------------------------------------------
//	COFF
//-----------------------------------------------------------------------------

const DOS_HEADER = {
	magic:		binary.UINT16_LE,
	cblp:		binary.UINT16_LE,
	cp:			binary.UINT16_LE,
	crlc:		binary.UINT16_LE,
	cparhdr:	binary.UINT16_LE,
	minalloc:	binary.UINT16_LE,
	maxalloc:	binary.UINT16_LE,
	ss:			binary.UINT16_LE,
	sp:			binary.UINT16_LE,
	csum:		binary.UINT16_LE,
	ip:			binary.UINT16_LE,
	cs:			binary.UINT16_LE,
	lfarlc:		binary.UINT16_LE,
	ovno:		binary.UINT16_LE,
};

const EXE_HEADER = {
	res:		new binary.FixedArrayType(binary.UINT16_LE,	4),
	oemid:		binary.UINT16_LE,
	oeminfo:	binary.UINT16_LE,
	res2:		new binary.FixedArrayType(binary.UINT16_LE,	10),
	lfanew:		binary.INT32_LE,
};

//-----------------------------------------------------------------------------
//	PE
//-----------------------------------------------------------------------------

const FILE_HEADER = {
	Machine:				binary.UINT16_LE,
	NumberOfSections:		binary.UINT16_LE,
	TimeDateStamp:			binary.UINT32_LE,
	PointerToSymbolTable:	binary.UINT32_LE,
	NumberOfSymbols:		binary.UINT32_LE,
	SizeOfOptionalHeader:	binary.UINT16_LE,
	Characteristics:		binary.UINT16_LE,
};

const SECTION_HEADER = {
	Name:					new binary.FixedStringType(8),
	VirtualSize:			binary.UINT32_LE,
	VirtualAddress:			binary.UINT32_LE,
	SizeOfRawData:			binary.UINT32_LE,
	PointerToRawData:		binary.UINT32_LE,
	PointerToRelocations:	binary.UINT32_LE,
	PointerToLinenumbers:	binary.UINT32_LE,
	NumberOfRelocations:	binary.INT16_LE,
	NumberOfLinenumbers:	binary.INT16_LE,
	Characteristics:		binary.UINT32_LE,
};

export const DIRECTORY = {
	EXPORT:			0,	// Export Directory
	IMPORT:			1,	// Import Directory
	RESOURCE:		2,	// Resource Directory
	EXCEPTION:		3,	// Exception Directory
	SECURITY:		4,	// Security Directory
	BASERELOC:		5,	// Base Relocation Table
	DEBUG_DIR:		6,	// Debug Directory
	COPYRIGHT:		7,	// (X86 usage)
	ARCHITECTURE:	7,	// Architecture Specific Data
	GLOBALPTR:		8,	// RVA of GP
	TLS:			9,
	LOAD_CONFIG:	10,	// Load Configuration Directory
	BOUND_IMPORT:	11,	// Bound Import Directory in headers
	IAT:			12,	// Import Address Table
	DELAY_IMPORT:	13,
	CLR_DESCRIPTOR:	14,
} as const;


const DIRECTORY_NAMES = [
	'EXPORT',		// Export Directory
	'IMPORT',		// Import Directory
	'RESOURCE',		// Resource Directory
	'EXCEPTION',	// Exception Directory
	'SECURITY',		// Security Directory
	'BASERELOC',	// Base Relocation Table
	'DEBUG_DIR',	// Debug Directory
	'ARCHITECTURE',	// Architecture Specific Data
	'GLOBALPTR',	// RVA of GP
	'TLS',
	'LOAD_CONFIG',	// Load Configuration Directory
	'BOUND_IMPORT',	// Bound Import Directory in headers
	'IAT',			// Import Address Table
	'DELAY_IMPORT',
	'CLR_DESCRIPTOR',
 ];

interface Directory {
	VirtualAddress: number,
	Size: 			number,
}

export const DATA_DIRECTORY = new binary.ObjectType({
	VirtualAddress: 			binary.UINT32_LE,
	Size: 						binary.UINT32_LE,
});

const MAGIC = {
	NT32:	0x10b,
	NT64:	0x20b,
	ROM:	0x107,
	OBJ:	0x104,	// object files, eg as output
	DEMAND:	0x10b,	// demand load format, eg normal ld output
	TARGET:	0x101,	// target shlib
	HOST:	0x123,	// host   shlib
} as const;

const OPTIONAL_HEADER = {
	Magic:						binary.UINT16_LE,
	MajorLinkerVersion:			binary.UINT8,
	MinorLinkerVersion:			binary.UINT8,
	SizeOfCode:					binary.UINT32_LE,
	SizeOfInitializedData:		binary.UINT32_LE,
	SizeOfUninitializedData:	binary.UINT32_LE,
	AddressOfEntryPoint:		binary.UINT32_LE,
	BaseOfCode:					binary.UINT32_LE,
};

const OPTIONAL_HEADER32 = {
	BaseOfData: 				binary.UINT32_LE,
	ImageBase:  				binary.UINT32_LE,
	SectionAlignment:   		binary.UINT32_LE,
	FileAlignment:  			binary.UINT32_LE,
	MajorOperatingSystemVersion:binary.UINT16_LE,
	MinorOperatingSystemVersion:binary.UINT16_LE,
	MajorImageVersion:  		binary.UINT16_LE,
	MinorImageVersion:  		binary.UINT16_LE,
	MajorSubsystemVersion:  	binary.UINT16_LE,
	MinorSubsystemVersion:  	binary.UINT16_LE,
	Win32VersionValue:  		binary.UINT32_LE,
	SizeOfImage:				binary.UINT32_LE,
	SizeOfHeaders:  			binary.UINT32_LE,
	CheckSum:   				binary.UINT32_LE,
	Subsystem:  				binary.UINT16_LE,
	DllCharacteristics: 		binary.UINT16_LE,
	SizeOfStackReserve: 		binary.UINT32_LE,
	SizeOfStackCommit:  		binary.UINT32_LE,
	SizeOfHeapReserve:  		binary.UINT32_LE,
	SizeOfHeapCommit:   		binary.UINT32_LE,
	LoaderFlags:				binary.UINT32_LE,
	NumberOfRvaAndSizes:		binary.UINT32_LE,
	DataDirectory:  			new binary.RemainingArrayType(DATA_DIRECTORY, DIRECTORY_NAMES),
};

const OPTIONAL_HEADER64 = {
	ImageBase:  				binary.UINT64_LE,
	SectionAlignment:   		binary.UINT32_LE,
	FileAlignment:  			binary.UINT32_LE,
	MajorOperatingSystemVersion:binary.UINT16_LE,
	MinorOperatingSystemVersion:binary.UINT16_LE,
	MajorImageVersion:  		binary.UINT16_LE,
	MinorImageVersion:  		binary.UINT16_LE,
	MajorSubsystemVersion:  	binary.UINT16_LE,
	MinorSubsystemVersion:  	binary.UINT16_LE,
	Win32VersionValue:  		binary.UINT32_LE,
	SizeOfImage:    			binary.UINT32_LE,
	SizeOfHeaders:  			binary.UINT32_LE,
	CheckSum:   				binary.UINT32_LE,
	Subsystem:  				binary.UINT16_LE,
	DllCharacteristics: 		binary.UINT16_LE,
	SizeOfStackReserve: 		binary.UINT64_LE,
	SizeOfStackCommit:  		binary.UINT64_LE,
	SizeOfHeapReserve:  		binary.UINT64_LE,
	SizeOfHeapCommit:   		binary.UINT64_LE,
	LoaderFlags:    			binary.UINT32_LE,
	NumberOfRvaAndSizes:    	binary.UINT32_LE,
	DataDirectory:  			new binary.RemainingArrayType(DATA_DIRECTORY, DIRECTORY_NAMES),
};

const IRT = {
	NONE:			0,
	CURSOR:			1,
	BITMAP:			2,
	ICON:			3,
	MENU:			4,
	DIALOG:			5,
	STRING:			6,
	FONTDIR:		7,
	FONT:			8,
	ACCELERATOR:	9,
	RCDATA:			10,
	MESSAGETABLE:	11,
	GROUP_CURSOR:	12,
	GROUP_ICON:		14,
	VERSION:		16,
	DLGINCLUDE:		17,
	PLUGPLAY:		19,
	VXD:			20,
	ANICURSOR:		21,
	ANIICON:		22,
	HTML:			23,
	MANIFEST:		24,
	TOOLBAR:		241,
} as const;

export class PE {
    sections:	any[];
	opt:		any;

	static async load(dll: string) {
		const data = await fs.loadFile(dll);
		if (data) {
			const file	= new binary.stream(data);
			const exe	= file.read_fields({...DOS_HEADER, ...EXE_HEADER});
			file.seek(exe.lfanew);
			if (file.read(binary.UINT32_LE) == stringCode("PE\0\0"))
				return new PE(file);
		}
	}
    
    private constructor(public file: binary.stream) {
		const h = file.read_fields(FILE_HEADER);
		if (h.SizeOfOptionalHeader) {
			const opt	= new binary.stream(file.read_buffer(h.SizeOfOptionalHeader));
			this.opt	= opt.read_fields(OPTIONAL_HEADER);
			if (this.opt.Magic == MAGIC.NT32)
				opt.read_fields(OPTIONAL_HEADER32, this.opt);
			else if (this.opt.Magic == MAGIC.NT64)
				opt.read_fields(OPTIONAL_HEADER64, this.opt);
		}

		this.sections = file.readn(new binary.ObjectType(SECTION_HEADER), h.NumberOfSections);
	}

	FindSectionRVA(rva: number) {
		for (const i of this.sections) {
			if (rva >= i.VirtualAddress && rva < i.VirtualAddress + i.SizeOfRawData)
				return i;
		}
	}

	FindSectionRaw(addr: number) {
		for (const i of this.sections) {
			if (addr >= i.PointerToRawData && addr < i.PointerToRawData + i.SizeOfRawData)
				return i;
		}
	}

	SectionData(section: any) {
		return this.file.buffer_at(section.PointerToRawData, section.SizeOfRawData);
	}

	GetDataRVA(rva: number, size: number) {
		const sect = this.FindSectionRVA(rva);
		const offset = rva - sect.VirtualAddress;
		return this.SectionData(sect).subarray(offset, offset + size);
	}
	GetDataRaw(addr: number, size: number) {
		const sect = this.FindSectionRaw(addr);
		const offset = addr - sect.PointerToRawData;
		return this.SectionData(sect).subarray(offset, offset + size);
	}
	GetDataDir(dir: Directory) {
		if (dir.Size)
			return this.GetDataRVA(dir.VirtualAddress, dir.Size);
	}

	GetResources() {
		const res_dir	= this.opt.DataDirectory.RESOURCE;
		if (res_dir.Size) {
			const res_data	= this.GetDataDir(res_dir)!;
			return ReadResourceDirectory(new binary.stream(res_data), res_data, res_dir.VirtualAddress);
		}
	}
}

//-----------------------------------------------------------------------------
//	resources
//-----------------------------------------------------------------------------

const RESOURCE_DIRECTORY_ENTRY = {
	get(s: binary.stream) {
		const u0 = binary.UINT32_LE.get(s);
		const u1 = binary.UINT32_LE.get(s);
		return [u0, u1];
	},
	put(s: binary.stream) {}

};

const RESOURCE_DATA_ENTRY = {
	OffsetToData:	binary.UINT32_LE,
	Size:			binary.UINT32_LE,
	CodePage:		binary.UINT32_LE,
	Reserved:		binary.UINT32_LE,
};

const RESOURCE_DIRECTORY = {
	Characteristics:		binary.UINT32_LE,
	TimeDateStamp:			binary.UINT32_LE,
	MajorVersion:			binary.UINT16_LE,
	MinorVersion:			binary.UINT16_LE,
	NumberOfNamedEntries:	binary.UINT16_LE,
	NumberOfIdEntries:		binary.UINT16_LE,
};

export function ReadResourceDirectory(file: binary.stream, data: Uint8Array, va: number, type = IRT.NONE) {
	const dir 		= file.read_fields(RESOURCE_DIRECTORY);
	const n			= dir.NumberOfNamedEntries + dir.NumberOfIdEntries;
	const entries	= file.readn(RESOURCE_DIRECTORY_ENTRY, n);
	const id_type	= new binary.StringType(binary.UINT16_LE, 'utf16le');

	const result : Record<string, any> = {};
	for (const i of entries) {
		const id = i[0] & (1 << 31) ? id_type.get(file.seek(i[0] & ~0x80000000)) : i[0];
		if (!type && !(i[0] & (1 << 31)))
			type = i[0];
		file.seek(i[1] & 0x7fffffff);
		let	e;
		if (i[1] & (1 << 31)) {
			e		= ReadResourceDirectory(file, data, va, type);
		} else {
			e		= file.read_fields(RESOURCE_DATA_ENTRY);
			e.data	= data.subarray(e.OffsetToData - va, e.OffsetToData - va + e.Size);
		}
		result[id] = e;
	}
	return result;
}
