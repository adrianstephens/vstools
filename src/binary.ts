import { TextDecoder, TextEncoder } from "util";

//-----------------------------------------------------------------------------
//	Microsoft Compound Document
//-----------------------------------------------------------------------------

type ReadType = {
	len: number,
	get(dv : DataView) : any,
	put(dv : DataView, v : any) : void
};

type ReadSpec = [string, ReadType];

interface array_buffer {
	buffer : ArrayBuffer;
	byteLength : number;
	byteOffset : number;
	slice(begin : number, end?: number) : array_buffer;
}

export function to_raw(arg : array_buffer) {
	return new Uint8Array(arg.buffer, arg.byteOffset, arg.byteLength);
}

export class reader {
	public buffer : ArrayBuffer;
	public offset = 0;

	constructor(data : Uint8Array) {
		this.buffer = data.buffer;
	}
	public remaining() {
        return this.buffer.byteLength - this.offset;
    }
    public tell() {
		return this.offset;
	}
	public seek(offset : number) {
		this.offset = offset;
		return this;
	}
	public skip(offset : number) {
		this.offset += offset;
		return this;
	}
	public read(type: ReadType) {
		const dv = new DataView(this.buffer, this.offset);
		this.offset += type.len;
		return type.get(dv);
	}
	public read_buffer(len: number) {
		const offset = this.offset;
		this.offset += len;
		return new Uint8Array(this.buffer, offset, len);
	}
	public read_string(len: number, encoding? : string) {
		const offset = this.offset;
		this.offset += len;
        return new TextDecoder(encoding).decode(this.buffer.slice(offset, offset + len));
	}

	public read_field(spec : ReadSpec) {
		return [spec[0], this.read(spec[1])];
	}
	public read_fields(...specs : ReadSpec[]) {
		return Object.fromEntries(specs.map(spec => this.read_field(spec)));
	}

}
//8 bit
export const UINT8 = {
	len: 1,
	get(dv : DataView) 				{ return dv.getUint8(0); },
	put(dv : DataView, v : number)	{ dv.setUint8(0, v); }
};
export const INT8 = {
	len: 1,
	get(dv : DataView) 				{ return dv.getInt8(0); },
	put(dv : DataView, v : number)	{ dv.setInt8(0, v); }
};

//16 bit
export const UINT16_LE = {
	len: 2,
	get(dv : DataView) 				{ return dv.getUint16(0, true); },
	put(dv : DataView, v : number)	{ dv.setUint16(0, v, true); }
};
export const UINT16_BE = {
	len: 2,
	get(dv : DataView) 				{ return dv.getUint16(0); },
	put(dv : DataView, v : number)	{ dv.setUint16(0, v); }
};
export const INT16_LE = {
	len: 2,
	get(dv : DataView) 				{ return dv.getInt16(0, true); },
	put(dv : DataView, v : number)	{ dv.setInt16(0, v, true); }
};
export const INT16_BE = {
	len: 2,
	get(dv : DataView) 				{ return dv.getInt16(0); },
	put(dv : DataView, v : number)	{ dv.setInt16(0, v); }
};

//24 bit
export const UINT24_LE = {
	len: 3,
	get(dv : DataView) 				{ return dv.getUint16(0, true) | (dv.getUint8(0 + 2) << 16); },
	put(dv : DataView, v : number)	{ dv.setUint16(0, v, true); dv.setUint8(0 + 2, v >> 16); }
};
export const UINT24_BE = {
	len: 3,
	get(dv : DataView) 				{ return (dv.getUint16(0) << 8) | dv.getUint8(0 + 2); },
	put(dv : DataView, v : number)	{ dv.setUint16(0, v >> 8); dv.setUint8(0 + 2, v); }
};

//32 bit
export const UINT32_LE = {
	len: 4,
	get(dv : DataView) 				{ return dv.getUint32(0, true); },
	put(dv : DataView, v : number)	{ dv.setUint32(0, v, true); }
};
export const UINT32_BE = {
	len: 4,
	get(dv : DataView) 				{ return dv.getUint32(0); },
	put(dv : DataView, v : number)	{ dv.setUint32(0, v); }
};
export const INT32_LE = {
	len: 4,
	get(dv : DataView) 				{ return dv.getInt32(0, true); },
	put(dv : DataView, v : number)	{ dv.setInt32(0, v, true); }
};
export const INT32_BE = {
	len: 4,
	get(dv : DataView) 				{ return dv.getInt32(0); },
	put(dv : DataView, v : number)	{ dv.setInt32(0, v); }
};

//float
export const Float32_LE = {
	len: 4,
	get(dv : DataView) 				{ return dv.getFloat32(0, true); },
	put(dv : DataView, v : number)	{ dv.setFloat32(0, v, true); }
};
export const Float32_BE = {
	len: 4,
	get(dv : DataView) 				{ return dv.getFloat32(0); },
	put(dv : DataView, v : number)	{ dv.setFloat32(0, v); }
};
export const Float64_LE = {
	len: 8,
	get(dv : DataView) 				{ return dv.getFloat64(0, true); },
	put(dv : DataView, v : number)	{ dv.setFloat64(0, v, true); }
};
export const Float64_BE = {
	len: 8,
	get(dv : DataView) 				{ return dv.getFloat64(0); },
	put(dv : DataView, v : number)	{ dv.setFloat64(0, v); }
};

//others
export class Uint8ArrayType {
	constructor(public len : number) {}
	get(dv : DataView) 				{ return new Uint8Array(dv.buffer, dv.byteOffset, this.len); }
	put(dv : DataView, v : Uint8Array)	{
		let offset = 0;
		for (const i of v)
			dv.setUint8(offset++, i);
	}
}

export class StringType {
	public textDecoder : TextDecoder;
	constructor(public len : number, encoding? : string) {
		this.textDecoder = new TextDecoder(encoding);
	}
	get(dv : DataView) 				{
		const buffer = dv.buffer.slice(dv.byteOffset, dv.byteOffset + this.len);
		return this.textDecoder.decode(buffer);
	}
	put(dv : DataView, v : string) {}
}

export class BigIntType {
	constructor(public len : number, public bigendian : boolean = false) {}
	get(dv : DataView) {
		let result = 0n;
		if (this.bigendian) {
			let offset = 0;
			while (offset + 4 <= this.len) {
				result = (result << 32n) | BigInt(dv.getUint32(offset));
				offset += 4;
			}
			if (this.len & 2) {
				result = (result << 16n) | BigInt(dv.getUint16(offset));
				offset += 2;
			}
			if (this.len & 1)
				result |= (result << 8n) | BigInt(dv.getUint8(offset));
		} else {
			let offset = this.len;
			while (offset >= 4) {
				offset -= 4;
				result = (result << 32n) | BigInt(dv.getUint32(offset, true));
			}
			if (this.len & 2) {
				offset -= 2;
				result = (result << 16n) | BigInt(dv.getUint16(offset, true));
			}
			if (this.len & 1)
				result |= (result << 8n) | BigInt(dv.getUint8(--offset));
		}
		return result;
	}
	put(dv : DataView, v : bigint) {}
}

export class SkipType {
	constructor(public len : number) {}
	get(dv : DataView) 					{}
	put(dv : DataView, v : undefined)	{}
}


export const UINT64_LE = new BigIntType(8, false);
export const UINT64_BE = new BigIntType(8, true);
