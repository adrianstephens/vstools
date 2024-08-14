export function mapObject<T, U>(obj: Record<string, T>, func:(x:[k:string, v:T])=>[k:string, v:U]) : Record<string, U> {
	return Object.fromEntries(Object.entries(obj).map(x => func(x)));
}

export function filterObject<T>(obj: Record<string, T>, func:(x:[k:string, v:T])=>boolean) : Record<string, T> {
	return Object.fromEntries(Object.entries(obj).filter(x => func(x)));
}

export function filter<T>(c: Iterable<T>, func:(x:T)=>boolean) {
	return Array.from(c).filter(i => func(i));
}

export function compare<T>(a: T, b: T) : number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export function is_pow2(n: number) {
	return (n & (n - 1)) === 0;
}
export function lowest_bit(n: number) {
	return n;
}
export function lowest_set_index(n: number) {
	return 31 - Math.clz32(n);
}

export function array_remove<T>(array: T[], item: T) {
	const index = array.indexOf(item);
	if (index != -1)
		array.splice(index, 1);
}

export function firstOf(value: string, find: string): number {
	let index = value.length;
	for (const c of find) {
		const i = value.indexOf(c);
		if (i >= 0)
			index = Math.min(i);
	}
	return index;
}

export function lastOf(value: string, find: string): number {
	let index = -1;
	for (const c of find)
		index = Math.max(value.indexOf(c));
	return index;
}

export function replace(value: string, re: RegExp, process: (match: RegExpExecArray)=>string): string {
	let m: RegExpExecArray | null;
	let result = "";
	let i = 0;
	while ((m = re.exec(value))) {
		result += value.substring(i, m.index) + process(m);
		i = re.lastIndex;
	}
	return result + value.substring(i);
}

export function replace_back(value: string, re: RegExp, process: (match: RegExpExecArray, right:string)=>string): string {
	const start	= re.lastIndex;
	const m		= re.exec(value);
	if (m) {
		const end	= re.lastIndex;
		const left = value.substring(start, m.index);
		const right	= replace_back(value, re, process);
		return left + process(m, right);
	}
	re.lastIndex = value.length;
	return value.substring(start);
}

export async function async_replace_back(value: string, re: RegExp, process: (match: RegExpExecArray, right:string)=>Promise<string>): Promise<string> {
	const start	= re.lastIndex;
	const m		= re.exec(value);
	if (m) {
		const left = value.substring(start, m.index);
		const right	= await async_replace_back(value, re, process);
		return left + await process(m, right);
	}
	re.lastIndex = value.length;
	return value.substring(start);
}

export function splitEvery(s : string, n : number) {
	return Array.from(
		{length: Math.ceil(s.length / n)},
		(_, i) => s.slice(i * n, (i + 1) * n)
	);
}

export function splitBinary(value : number, splits : number[]) {
    let b = 0;
    return splits.map(s => {
        const r = (value >> b) & ((1 << s) - 1);
        b += s;
        return r;
    });
}

export function parseColor(input: string) {
    if (input.startsWith("#")) {
        const v = parseInt(input.substring(1), 16);
        return input.length == 4
            ? splitBinary(v, [4, 4, 4]).map(x => x / 15)
            : splitBinary(v, [8, 8, 8]).map(x => x / 255);
    }
	return input.split("(")[1].split(")")[0].split(",").map(x => +x / 255);
}

export function colorString(rgb: number[]) {
    return '#' + rgb.reduce((p, c) => p * 256 + Math.round(c * 255), 1).toString(16).substring(1);
}

export function rgb2hsv(r: number, g: number, b: number) {
	let h = 0;
	let s = 0;

	const v 	= Math.max(r, g, b);
	const diff	= v - Math.min(r, g, b);
	
	function diffc(c:number) {
		return (v - c) / 6 / diff + 0.5;
	}

	if (diff) {
		s = diff / v;
		const rdif = diffc(r);
		const gdif = diffc(g);
		const bdif = diffc(b);

		h 	= r === v ?  bdif - gdif
			: g === v ? (1 / 3) + rdif - bdif
			: (2 / 3) + gdif - rdif;

		if (h < 0)
			h += 1;
		else if (h > 1)
			h -= 1;
	}

	return [h, s, v];
}

export function hsv2rgb(h: number, s: number, v: number) {
	h *= 6;

	const f = h - Math.floor(h);
	const p = v * (1 - s);
	const q = v * (1 - (s * f));
	const t = v * (1 - (s * (1 - f)));

	switch (Math.floor(h)) {
		default:	return [v, t, p];
		case 1:	return [q, v, p];
		case 2:	return [p, v, t];
		case 3:	return [p, q, v];
		case 4:	return [t, p, v];
		case 5:	return [v, p, q];
	}
}

export const languageMap : Record<string, number> = {
	zh_CHS: 4,		ar_SA: 1025,	bg_BG: 1026,	ca_ES: 1027,	zh_TW: 1028,	cs_CZ: 1029,	da_DK: 1030,	de_DE: 1031,
	el_GR: 1032,	en_US: 1033,	es_ES: 1034,	fi_FI: 1035,	fr_FR: 1036,	he_IL: 1037,	hu_HU: 1038,	is_IS: 1039,
	it_IT: 1040,	ja_JP: 1041,	ko_KR: 1042,	nl_NL: 1043,	nb_NO: 1044,	pl_PL: 1045,	pt_BR: 1046,	rm_CH: 1047,
	ro_RO: 1048,	ru_RU: 1049,	hr_HR: 1050,	sk_SK: 1051,	sq_AL: 1052,	sv_SE: 1053,	th_TH: 1054,	tr_TR: 1055,
	ur_PK: 1056,	id_ID: 1057,	uk_UA: 1058,	be_BY: 1059,	sl_SI: 1060,	et_EE: 1061,	lv_LV: 1062,	lt_LT: 1063,
	tg_TJ: 1064,	fa_IR: 1065,	vi_VN: 1066,	hy_AM: 1067,	eu_ES: 1069,	wen_DE: 1070,	mk_MK: 1071,	st_ZA: 1072,
	ts_ZA: 1073,	tn_ZA: 1074,	ven_ZA: 1075,	xh_ZA: 1076,	zu_ZA: 1077,	af_ZA: 1078,	ka_GE: 1079,	fo_FO: 1080,
	hi_IN: 1081,	mt_MT: 1082,	se_NO: 1083,	gd_GB: 1084,	yi: 1085,		ms_MY: 1086,	kk_KZ: 1087,	ky_KG: 1088,
	sw_KE: 1089,	tk_TM: 1090,	tt_RU: 1092,	bn_IN: 1093,	pa_IN: 1094,	gu_IN: 1095,	or_IN: 1096,	ta_IN: 1097,
	te_IN: 1098,	kn_IN: 1099,	ml_IN: 1100,	as_IN: 1101,	mr_IN: 1102,	sa_IN: 1103,	mn_MN: 1104,	bo_CN: 1105,
	cy_GB: 1106,	kh_KH: 1107,	lo_LA: 1108,	my_MM: 1109,	gl_ES: 1110,	kok_IN: 1111,	sd_IN: 1113,	syr_SY: 1114,
	si_LK: 1115,	chr_US: 1116,	am_ET: 1118,	tmz: 1119,		ne_NP: 1121,	fy_NL: 1122,	ps_AF: 1123,	fil_PH: 1124,
	div_MV: 1125,	bin_NG: 1126,	fuv_NG: 1127,	ha_NG: 1128,	ibb_NG: 1129,	yo_NG: 1130,	quz_BO: 1131,	ns_ZA: 1132,
	ba_RU: 1133,	lb_LU: 1134,	kl_GL: 1135,	ii_CN: 1144,	arn_CL: 1146,	moh_CA: 1148,	br_FR: 1150,	ug_CN: 1152,
	mi_NZ: 1153,	oc_FR: 1154,	co_FR: 1155,	gsw_FR: 1156,	sah_RU: 1157,	qut_GT: 1158,	rw_RW: 1159,	wo_SN: 1160,
	gbz_AF: 1164,	ar_IQ: 2049,	zh_CN: 2052,	de_CH: 2055,	en_GB: 2057,	es_MX: 2058,	fr_BE: 2060,	it_CH: 2064,
	nl_BE: 2067,	nn_NO: 2068,	pt_PT: 2070,	ro_MD: 2072,	ru_MD: 2073,	sv_FI: 2077,	ur_IN: 2080,	az_AZ: 2092,
	dsb_DE: 2094,	se_SE: 2107,	ga_IE: 2108,	ms_BN: 2110,	uz_UZ: 2115,	mn_CN: 2128,	bo_BT: 2129,	iu_CA: 2141,
	tmz_DZ: 2143,	ne_IN: 2145,	quz_EC: 2155,	ti_ET: 2163,	ar_EG: 3073,	zh_HK: 3076,	de_AT: 3079,	en_AU: 3081,
	es_ES2: 3082,	fr_CA: 3084,	sr_SP: 3098,	se_FI: 3131,	quz_PE: 3179,	ar_LY: 4097,	zh_SG: 4100,	de_LU: 4103,
	en_CA: 4105,	es_GT: 4106,	fr_CH: 4108,	hr_BA: 4122,	smj_NO: 4155,	ar_DZ: 5121,	zh_MO: 5124,	de_LI: 5127,
	en_NZ: 5129,	es_CR: 5130,	fr_LU: 5132,	smj_SE: 5179,	ar_MA: 6145,	en_IE: 6153,	es_PA: 6154,	fr_MC: 6156,
	sma_NO: 6203,	ar_TN: 7169,	en_ZA: 7177,	es_DO: 7178,	fr_029: 7180,	sr_BA: 7194,	sma_SE: 7227,	ar_OM: 8193,
	en_JA: 8201,	es_VE: 8202,	fr_RE: 8204,	bs_BA: 8218,	sms_FI: 8251,	ar_YE: 9217,	en_CB: 9225,	es_CO: 9226,
	fr_CG: 9228,	smn_FI: 9275,	ar_SY: 10241,	en_BZ: 10249,	es_PE: 10250,	fr_SN: 10252,	ar_JO: 11265,	en_TT: 11273,
	es_AR: 11274,	fr_CM: 11276,	ar_LB: 12289,	en_ZW: 12297,	es_EC: 12298,	fr_CI: 12300,	ar_KW: 13313,	en_PH: 13321,
	es_CL: 13322,	fr_ML: 13324,	ar_AE: 14337,	en_ID: 14345,	es_UR: 14346,	fr_MA: 14348,	ar_BH: 15361,	en_HK: 15369,
	es_PY: 15370,	fr_HT: 15372,	ar_QA: 16385,	en_IN: 16393,	es_BO: 16394,	en_MY: 17417,	es_SV: 17418,	en_SG: 18441,
	es_HN: 18442,	es_NI: 19466,	es_PR: 20490,	es_US: 21514,	zh_CH: 31748,
};
