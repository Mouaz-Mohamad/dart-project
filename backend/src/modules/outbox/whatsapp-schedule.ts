export function whatsappSendWindow(reference = new Date()): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo", hour: "2-digit", hourCycle: "h23",
  }).format(reference));
  return hour >= 13 && hour < 22;
}
