import { ImageResponse } from 'workers-og'
import { ens_beautify, ens_normalize } from '@adraffy/ens-normalize'
import emojiRegex from 'emoji-regex'
import type { Env } from '../env'
import { HttpError } from '../lib/errors'
import { fetchImageBytes, resolveUriCached } from './image'
import SatoshiBlack from '../fonts/Satoshi-Black.otf'

export type NameImageInput = {
	env: Env
	ctx: ExecutionContext
	networkName: string
	name: string
	expired: boolean
}

type ResolvedAvatar = { contentType: string; bytes: ArrayBuffer } | null

async function resolveAvatar(
	env: Env,
	ctx: ExecutionContext,
	networkName: string,
	name: string,
): Promise<ResolvedAvatar> {
	let uri: string
	try {
		uri = await resolveUriCached(env, 'avatar', networkName, name, ctx)
	} catch (err) {
		if (err instanceof HttpError) return null
		throw err
	}
	try {
		const image = await fetchImageBytes(env, uri, ctx)
		const bytes =
			image.body instanceof ArrayBuffer
				? image.body
				: await new Response(image.body).arrayBuffer()
		return { contentType: image.contentType, bytes }
	} catch {
		return null
	}
}

type Style = Record<string, string | number>
type Element = {
	type: string
	props: {
		style?: Style
		children?: Element[] | string
		[key: string]: unknown
	}
}

const SIZE = 1024
const PADDING = 124
const MAX_TEXT_WIDTH = SIZE - PADDING * 2
const MAX_CHARS = 60
const LINE_SPLIT_CHARS = 25
const LOGO_WIDTH = 160
const LOGO_HEIGHT = 182
const WARNING_SIZE = 150

const GRADIENT_BLUE =
	'linear-gradient(315deg, #44BCF0 0%, #628BF3 43%, #A099FF 100%)'
const GRADIENT_GRAY = 'linear-gradient(135deg, #C1C1C1 0%, #4F4F4F 100%)'
const GRADIENT_RED = 'linear-gradient(135deg, #EB9E9E 0%, #992222 100%)'

const ENS_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="42" height="48" viewBox="32 32 42 48" fill="none"><path d="M38.0397 51.0875C38.5012 52.0841 39.6435 54.0541 39.6435 54.0541L52.8484 32L39.9608 41.0921C39.1928 41.6096 38.5628 42.3102 38.1263 43.1319C37.5393 44.3716 37.2274 45.7259 37.2125 47.1C37.1975 48.4742 37.4799 49.8351 38.0397 51.0875Z" fill="white"/><path d="M32.152 59.1672C32.3024 61.2771 32.9122 63.3312 33.9405 65.1919C34.9689 67.0527 36.3921 68.6772 38.1147 69.9567L52.8487 80C52.8487 80 43.6303 67.013 35.8549 54.0902C35.0677 52.7249 34.5385 51.2322 34.2926 49.6835C34.1838 48.9822 34.1838 48.2689 34.2926 47.5676C34.0899 47.9348 33.6964 48.6867 33.6964 48.6867C32.908 50.2586 32.371 51.9394 32.1043 53.6705C31.9508 55.5004 31.9668 57.3401 32.152 59.1672Z" fill="white"/><path d="M70.1927 60.9125C69.6928 59.9159 68.4555 57.946 68.4555 57.946L54.1514 80L68.1118 70.9138C68.9436 70.3962 69.6261 69.6956 70.099 68.8739C70.7358 67.6334 71.0741 66.2781 71.0903 64.9029C71.1065 63.5277 70.8001 62.1657 70.1927 60.9125Z" fill="white"/><path d="M74.8512 52.8328C74.7008 50.7229 74.0909 48.6688 73.0624 46.8081C72.0339 44.9473 70.6105 43.3228 68.8876 42.0433L54.1514 32C54.1514 32 63.3652 44.987 71.1478 57.9098C71.933 59.2755 72.4603 60.7682 72.7043 62.3165C72.8132 63.0178 72.8132 63.7311 72.7043 64.4324C72.9071 64.0652 73.3007 63.3133 73.3007 63.3133C74.0892 61.7414 74.6262 60.0606 74.893 58.3295C75.0485 56.4998 75.0345 54.66 74.8512 52.8328Z" fill="white"/></svg>`

const WARNING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="200 34 40 40" fill="none"><rect x="200" y="34" width="40" height="40" rx="20" fill="white" fill-opacity="0.2"/><path fill-rule="evenodd" clip-rule="evenodd" d="M217.472 44.4655C218.581 42.5115 221.42 42.5115 222.528 44.4655L230.623 58.7184C231.711 60.6351 230.314 63 228.096 63H211.905C209.686 63 208.289 60.6351 209.377 58.7184L217.472 44.4655ZM221.451 58.6911C221.451 59.0722 221.298 59.4376 221.026 59.7071C220.754 59.9765 220.385 60.1279 220 60.1279C219.615 60.1279 219.246 59.9765 218.974 59.7071C218.702 59.4376 218.549 59.0722 218.549 58.6911C218.549 58.31 218.702 57.9446 218.974 57.6751C219.246 57.4057 219.615 57.2543 220 57.2543C220.385 57.2543 220.754 57.4057 221.026 57.6751C221.298 57.9446 221.451 58.31 221.451 58.6911V58.6911ZM220 47.1968C219.615 47.1968 219.246 47.3482 218.974 47.6177C218.702 47.8871 218.549 48.2526 218.549 48.6336V52.944C218.549 53.325 218.702 53.6905 218.974 53.9599C219.246 54.2294 219.615 54.3807 220 54.3807C220.385 54.3807 220.754 54.2294 221.026 53.9599C221.298 53.6905 221.451 53.325 221.451 52.944V48.6336C221.451 48.2526 221.298 47.8871 221.026 47.6177C220.754 47.3482 220.385 47.1968 220 47.1968Z" fill="white"/></svg>`

const ENS_LOGO_URI = svgDataUri(ENS_LOGO_SVG)
const WARNING_URI = svgDataUri(WARNING_SVG)

function svgDataUri(svg: string): string {
	return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const APPLE_EMOJI_BASE =
	'https://cdn.jsdelivr.net/gh/iamcal/emoji-data@master/img-apple-64'

const GOOGLE_FONT_UA =
	'Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1'

type FallbackFont = {
	name: string
	family: string
	weight: number
	test: RegExp
}

// Ordered by likelihood of tripping the opentype.js shaping bug — unlikely
// first, Arabic last. On `lookupType`/`OpenType signature` errors we drop
// from the tail of this list until rendering succeeds, so complex-shaping
// fonts are the first to go.
const FALLBACK_FONTS: FallbackFont[] = [
	{
		name: 'NotoSym',
		family: 'Noto Sans Symbols',
		weight: 700,
		test: /[\u2190-\u21FF\u2460-\u24FF\u2600-\u27BF]/u,
	},
	{
		name: 'NotoSym2',
		family: 'Noto Sans Symbols 2',
		weight: 400,
		test: /[\u2200-\u22FF\u2300-\u23FF\u2500-\u25FF\u2B00-\u2BFF]/u,
	},
	{
		name: 'NotoSansExt',
		family: 'Noto Sans',
		weight: 700,
		test: /[\u0080-\u024F\u0370-\u03FF\u0400-\u04FF\u0500-\u052F\u0530-\u058F\u1E00-\u1EFF\u2000-\u218F]/u,
	},
	{
		name: 'NotoNKo',
		family: 'Noto Sans NKo',
		weight: 400,
		test: /[\u07C0-\u07FF]/u,
	},
	{
		name: 'NotoSC',
		family: 'Noto Sans SC',
		weight: 900,
		test: /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F\u3400-\u4DBF]/u,
	},
	{
		name: 'NotoJP',
		family: 'Noto Sans JP',
		weight: 900,
		test: /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF]/u,
	},
	{
		name: 'NotoKR',
		family: 'Noto Sans KR',
		weight: 900,
		test: /[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uAC00-\uD7AF]/u,
	},
	{
		name: 'NotoETH',
		family: 'Noto Sans Ethiopic',
		weight: 700,
		test: /[\u1200-\u137F\u1380-\u139F\u2D80-\u2DDF]/u,
	},
	{
		name: 'NotoTH',
		family: 'Noto Sans Thai',
		weight: 700,
		test: /[\u0E00-\u0E7F]/u,
	},
	{
		name: 'NotoHE',
		family: 'Noto Sans Hebrew',
		weight: 700,
		test: /[\u0590-\u05FF\uFB1D-\uFB4F]/u,
	},
	{
		name: 'NotoAR',
		family: 'Noto Sans Arabic',
		weight: 700,
		test: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u,
	},
]

type LoadedFont = {
	name: string
	data: ArrayBuffer
	weight: number
	style: 'normal'
}

async function loadGoogleFontSubset(
	family: string,
	weight: number,
	text: string,
): Promise<ArrayBuffer | null> {
	if (!text) return null
	const unique = [...new Set(text)].join('')
	const baseUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
		family,
	)}:wght@${weight}`
	// Prefer the per-character subset (small). For some families — notably
	// Noto Sans Symbols and Noto Sans Symbols 2 — Google's `/l/font?kit=…`
	// subset URLs currently return 400, so fall back to the full font file.
	const cssUrls = [
		`${baseUrl}&text=${encodeURIComponent(unique)}`,
		baseUrl,
	]
	for (const cssUrl of cssUrls) {
		try {
			const cssRes = await fetch(cssUrl, {
				headers: { 'User-Agent': GOOGLE_FONT_UA },
				cf: { cacheTtl: 86400, cacheEverything: true },
			} as RequestInit)
			if (!cssRes.ok) continue
			const css = await cssRes.text()
			const match = css.match(/src:\s*url\((https:\/\/[^)]+)\)/)
			if (!match) continue
			const fontRes = await fetch(match[1]!, {
				cf: { cacheTtl: 86400, cacheEverything: true },
			} as RequestInit)
			if (!fontRes.ok) continue
			return await fontRes.arrayBuffer()
		} catch {
			// try next URL
		}
	}
	return null
}

async function loadFallbackFonts(text: string): Promise<LoadedFont[]> {
	if (!text) return []
	const results = await Promise.all(
		FALLBACK_FONTS.map(async f => {
			const chars = Array.from(text)
				.filter(c => f.test.test(c))
				.join('')
			if (!chars) return null
			const data = await loadGoogleFontSubset(f.family, f.weight, chars)
			if (!data) return null
			// Report all fallbacks at weight 900 to match the primary text element.
			// Satori filters fallback candidates by weight when picking a glyph, so
			// registering at the font's actual upstream weight (e.g. 400 for
			// Noto Sans Symbols 2) prevents it from being used against bold text.
			return {
				name: f.name,
				data,
				weight: 900,
				style: 'normal' as const,
			}
		}),
	)
	return results.filter((f): f is LoadedFont => f !== null)
}

function emojiCodepointPath(emoji: string): string {
	return Array.from(emoji)
		.map(c => c.codePointAt(0)!.toString(16))
		.join('-')
}

async function fetchEmojiBytes(path: string): Promise<ArrayBuffer | null> {
	try {
		const res = await fetch(`${APPLE_EMOJI_BASE}/${path}.png`, {
			cf: { cacheTtl: 86400, cacheEverything: true },
		} as RequestInit)
		if (!res.ok) return null
		return await res.arrayBuffer()
	} catch {
		return null
	}
}

async function fetchEmojiDataUri(emoji: string): Promise<string | null> {
	const full = emojiCodepointPath(emoji)
	const stripped = emojiCodepointPath(emoji.replaceAll('\uFE0F', ''))
	const bytes =
		(await fetchEmojiBytes(full)) ??
		(full !== stripped ? await fetchEmojiBytes(stripped) : null)
	if (!bytes) return null
	return `data:image/png;base64,${bytesToBase64(bytes)}`
}

async function prepareEmojis(
	texts: Array<string | null>,
): Promise<Map<string, string>> {
	const regex = emojiRegex()
	const unique = new Set<string>()
	for (const text of texts) {
		if (!text) continue
		for (const m of text.matchAll(regex)) unique.add(m[0])
	}
	if (unique.size === 0) return new Map()
	const entries = await Promise.all(
		[...unique].map(
			async emoji => [emoji, await fetchEmojiDataUri(emoji)] as const,
		),
	)
	const results = new Map<string, string>()
	for (const [emoji, uri] of entries) {
		if (uri) results.set(emoji, uri)
	}
	return results
}

function textSpan(text: string): Element {
	return { type: 'span', props: { children: text } }
}

function splitText(
	text: string,
	fontSize: number,
	emojis: Map<string, string>,
): Element[] {
	const regex = emojiRegex()
	const parts: Element[] = []
	let lastIndex = 0
	for (const match of text.matchAll(regex)) {
		const start = match.index!
		if (start > lastIndex) {
			const before = stripLooseFE0F(text.slice(lastIndex, start))
			if (before) parts.push(textSpan(before))
		}
		const uri = emojis.get(match[0])
		if (uri) {
			parts.push({
				type: 'img',
				props: { src: uri, width: fontSize, height: fontSize },
			})
		} else {
			parts.push(textSpan(match[0]))
		}
		lastIndex = start + match[0].length
	}
	if (lastIndex < text.length) {
		const tail = stripLooseFE0F(text.slice(lastIndex))
		if (tail) parts.push(textSpan(tail))
	}
	if (parts.length === 0) parts.push(textSpan(''))
	return parts
}

function isNormalized(name: string): boolean {
	try {
		return ens_normalize(name) === name
	} catch {
		return false
	}
}

function splitSubdomain(name: string): {
	parent: string
	subdomain: string | null
} {
	const labels = name.split('.')
	if (labels.length <= 2) return { parent: name, subdomain: null }
	return {
		parent: labels.slice(-2).join('.'),
		subdomain: labels.slice(0, -2).join('.') + '.',
	}
}

function truncateParent(text: string): string {
	if (text.length <= MAX_CHARS) return text
	const head = text.slice(0, MAX_CHARS - 7)
	const tail = text.slice(-7, -4)
	return `${head}...${tail}.eth`
}

function truncateSubdomain(text: string): string {
	if (text.length <= MAX_CHARS) return text
	return `${text.slice(0, MAX_CHARS - 4)}...`
}

const NAME_FONT_CAP = 128
const TEXT_CHAR_ADVANCE = 0.56
const EMOJI_CHAR_ADVANCE = 1.0

function stripLooseFE0F(text: string): string {
	return text.replaceAll('\uFE0F', '')
}

/** Width of `text` (advance units at font-size 1) — emojis count as 1em, text as ~0.56em per UTF-16 unit. */
function widthPerEm(text: string): number {
	const regex = emojiRegex()
	let width = 0
	let lastIndex = 0
	for (const match of text.matchAll(regex)) {
		const before = stripLooseFE0F(text.slice(lastIndex, match.index!))
		width += before.length * TEXT_CHAR_ADVANCE
		width += EMOJI_CHAR_ADVANCE
		lastIndex = match.index! + match[0].length
	}
	width += stripLooseFE0F(text.slice(lastIndex)).length * TEXT_CHAR_ADVANCE
	return width
}

function nameFontSize(text: string): number {
	const em = widthPerEm(text)
	if (em === 0) return NAME_FONT_CAP
	return Math.min(NAME_FONT_CAP, Math.floor(MAX_TEXT_WIDTH / em))
}

function bytesToBase64(buf: ArrayBuffer): string {
	const arr = new Uint8Array(buf)
	let binary = ''
	const chunk = 0x8000
	for (let i = 0; i < arr.length; i += chunk) {
		binary += String.fromCharCode(...arr.subarray(i, i + chunk))
	}
	return btoa(binary)
}

function pickGradient(normalized: boolean, expired: boolean): string {
	if (!normalized) return GRADIENT_RED
	if (expired) return GRADIENT_GRAY
	return GRADIENT_BLUE
}

function avatarDataUri(avatar: ResolvedAvatar): string | null {
	if (!avatar) return null
	return `data:${avatar.contentType};base64,${bytesToBase64(avatar.bytes)}`
}

function img(src: string, width: number, height: number): Element {
	return { type: 'img', props: { src, width, height } }
}

function div(style: Style, children?: Element[] | string): Element {
	return {
		type: 'div',
		props: children === undefined ? { style } : { style, children },
	}
}

function buildTree(args: {
	name: string
	expired: boolean
	avatar: ResolvedAvatar
	emojis: Map<string, string>
}): Element {
	const normalized = isNormalized(args.name)
	const displayName = normalized ? ens_beautify(args.name) : args.name
	const { parent, subdomain } = splitSubdomain(displayName)

	const parentText = truncateParent(parent)
	const subdomainText =
		subdomain !== null ? truncateSubdomain(subdomain) : null

	const parentFont = nameFontSize(parent)
	const subFont = subdomain ? nameFontSize(subdomain) : 0
	const hasSubdomain = subdomain !== null

	const avatarUri = avatarDataUri(args.avatar)
	const rootStyle: Style = {
		position: 'relative',
		display: 'flex',
		flexDirection: 'column',
		justifyContent: 'space-between',
		width: `${SIZE}px`,
		height: `${SIZE}px`,
		padding: `${PADDING}px`,
		background: pickGradient(normalized, args.expired),
	}

	const topRowChildren: Element[] = [
		img(ENS_LOGO_URI, LOGO_WIDTH, LOGO_HEIGHT),
	]
	if (!normalized) {
		topRowChildren.push(img(WARNING_URI, WARNING_SIZE, WARNING_SIZE))
	}

	const topRow = div(
		{
			display: 'flex',
			flexDirection: 'row',
			justifyContent: 'space-between',
			alignItems: 'flex-start',
			width: '100%',
		},
		topRowChildren,
	)

	const nameBlock = div(
		{
			color: 'white',
			opacity: hasSubdomain ? 0.4 : 1,
			fontFamily: 'Satoshi',
			fontWeight: 900,
			fontSize: `${parentFont}px`,
			lineHeight: 1,
			letterSpacing: '-0.02em',
			textShadow: '0 4px 8px rgba(0, 0, 0, 0.3)',
			maxWidth: `${MAX_TEXT_WIDTH}px`,
			display: 'flex',
			flexDirection: 'row',
			alignItems: 'center',
			...(hasSubdomain ? { marginTop: '24px' } : {}),
		},
		splitText(parentText, parentFont, args.emojis),
	)

	const bottomChildren: Element[] = []
	if (subdomainText !== null) {
		bottomChildren.push(
			div(
				{
					color: 'white',
					fontFamily: 'Satoshi',
					fontWeight: 900,
					fontSize: `${subFont}px`,
					lineHeight: 1,
					letterSpacing: '-0.02em',
					textShadow: '0 4px 8px rgba(0, 0, 0, 0.3)',
					maxWidth: `${MAX_TEXT_WIDTH}px`,
					display: 'flex',
					flexDirection: 'row',
					alignItems: 'center',
				},
				splitText(subdomainText, subFont, args.emojis),
			),
		)
	}
	bottomChildren.push(nameBlock)

	const bottomSection = div(
		{
			display: 'flex',
			flexDirection: 'column',
			alignItems: 'flex-start',
			width: '100%',
		},
		bottomChildren,
	)

	const rootChildren: Element[] = []
	if (avatarUri) {
		rootChildren.push({
			type: 'img',
			props: {
				src: avatarUri,
				width: SIZE,
				height: SIZE,
				style: {
					position: 'absolute',
					top: '0',
					left: '0',
					width: `${SIZE}px`,
					height: `${SIZE}px`,
					objectFit: 'cover',
				},
			},
		})
		rootChildren.push(
			div(
				{
					position: 'absolute',
					top: '0',
					left: '0',
					width: `${SIZE}px`,
					height: `${SIZE}px`,
					backgroundColor: 'rgba(0, 0, 0, 0.12)',
				},
				' ',
			),
		)
	}
	rootChildren.push(topRow)
	rootChildren.push(bottomSection)

	return div(rootStyle, rootChildren)
}

function isFontParseError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err)
	return /lookupType|OpenType signature|substFormat/.test(msg)
}

export async function renderNameImage(
	input: NameImageInput,
): Promise<ArrayBuffer> {
	const normalized = isNormalized(input.name)
	const displayName = normalized ? ens_beautify(input.name) : input.name
	const { parent, subdomain } = splitSubdomain(displayName)

	// Avatar, emoji image assets, and Google Font subsets are all independent
	// network work. Running them in parallel cuts cache-miss latency by the
	// cost of whichever is slowest (typically the avatar fetch).
	const [avatar, emojis, fallbackFonts] = await Promise.all([
		resolveAvatar(input.env, input.ctx, input.networkName, input.name),
		prepareEmojis([parent, subdomain]),
		loadFallbackFonts(displayName),
	])

	const tree = buildTree({
		name: input.name,
		expired: input.expired,
		avatar,
		emojis,
	})
	const satoshi = {
		name: 'Satoshi' as const,
		data: SatoshiBlack,
		weight: 900,
		style: 'normal' as const,
	}
	let fonts: Array<typeof satoshi | LoadedFont> = [satoshi, ...fallbackFonts]

	for (;;) {
		try {
			const response = new ImageResponse(tree as never, {
				width: SIZE,
				height: SIZE,
				format: 'png',
				fonts,
			})
			return await response.arrayBuffer()
		} catch (err) {
			if (!isFontParseError(err) || fonts.length <= 1) throw err
			fonts = fonts.slice(0, -1)
		}
	}
}
