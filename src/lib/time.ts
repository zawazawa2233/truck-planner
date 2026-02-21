export function addMinutesIso(baseIso: string, minutes: number): string {
  const date = new Date(baseIso);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}
