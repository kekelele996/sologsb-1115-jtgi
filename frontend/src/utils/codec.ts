import type { Specimen, Storage } from '@/types'

/** 标本编号：采集地代码-年份-流水号，如 QLB-2026-0007 */
export function buildSpecimenCode(siteCode: string, year: number | string, serial: number): string {
  return `${siteCode.toUpperCase()}-${year}-${String(serial).padStart(4, '0')}`
}

/** 解析标本编号 */
export function parseSpecimenCode(code: string): { siteCode: string; year: string; serial: number } | null {
  const match = /^([A-Za-z0-9]+)-(\d{4})-(\d{3,5})$/.exec(code.trim())
  if (!match) return null
  return { siteCode: match[1].toUpperCase(), year: match[2], serial: Number(match[3]) }
}

/** 在已有编号中查重 */
export function isDuplicateCode(code: string, existing: string[]): boolean {
  return existing.some((item) => item.trim().toUpperCase() === code.trim().toUpperCase())
}

/** 依据已有序号生成下一个流水号 */
export function nextSerial(siteCode: string, year: number | string, existingCodes: string[]): number {
  const serials = existingCodes
    .map((code) => parseSpecimenCode(code))
    .filter((parsed): parsed is { siteCode: string; year: string; serial: number } => parsed !== null)
    .filter((parsed) => parsed.siteCode === siteCode.toUpperCase() && parsed.year === String(year))
    .map((parsed) => parsed.serial)
  return serials.length > 0 ? Math.max(...serials) + 1 : 1
}

/** 生成不与已有编号冲突的标本编号 */
export function allocateSpecimenCode(
  siteCode: string,
  year: number | string,
  existingCodes: string[],
  reserved: string[] = []
): string {
  const used = [...existingCodes, ...reserved]
  let serial = nextSerial(siteCode, year, used)
  let code = buildSpecimenCode(siteCode, year, serial)
  while (isDuplicateCode(code, used)) {
    serial += 1
    code = buildSpecimenCode(siteCode, year, serial)
  }
  return code
}

/** 经纬度格式化：116.4042°E, 39.9136°N */
export function formatLatLng(longitude: number, latitude: number): string {
  const lon = `${Math.abs(longitude).toFixed(4)}°${longitude >= 0 ? 'E' : 'W'}`
  const lat = `${Math.abs(latitude).toFixed(4)}°${latitude >= 0 ? 'N' : 'S'}`
  return `${lon}, ${lat}`
}

/** 经纬度格式校验 */
export function validateLatLng(longitude: number, latitude: number): string | null {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return '经纬度必须是数字'
  if (longitude < -180 || longitude > 180) return '经度必须在 -180 ~ 180 之间'
  if (latitude < -90 || latitude > 90) return '纬度必须在 -90 ~ 90 之间'
  return null
}

/** 柜位字符串编解码：C03-D2-B05-S12 */
export function encodeSlot(cabinet: string, drawer: number, box: number, slot: number): string {
  return `${cabinet.toUpperCase()}-D${drawer}-B${String(box).padStart(2, '0')}-S${String(slot).padStart(2, '0')}`
}

export function decodeSlot(text: string): { cabinet: string; drawer: number; box: number; slot: number } | null {
  const match = /^([A-Za-z0-9]+)-D(\d+)-B(\d+)-S(\d+)$/.exec(text.trim())
  if (!match) return null
  return { cabinet: match[1].toUpperCase(), drawer: Number(match[2]), box: Number(match[3]), slot: Number(match[4]) }
}

/** 标本在柜中的显示位置 */
export function storageSlotText(storage: Storage): string {
  return encodeSlot(storage.cabinet, storage.drawer, storage.box, storage.slot)
}

/** 检查柜位是否已被占用 */
export function findSlotConflicts(storages: Storage[], target: Storage): Storage[] {
  const key = storageSlotText(target)
  return storages.filter((item) => item.id !== target.id && storageSlotText(item) === key)
}

/** 标本摘要文本 */
export function specimenTaxon(specimen: Specimen): string {
  const parts = [specimen.order, specimen.family, specimen.genus, specimen.species].filter(Boolean)
  return parts.length > 0 ? parts.join(' / ') : specimen.tempName || '未定名'
}
