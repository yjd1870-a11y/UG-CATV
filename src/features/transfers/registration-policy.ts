export const koreaDate = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

export const resolveInspectionRequestedDate = (
  selectedDate: string,
  userEdited: boolean,
  now = new Date(),
) => userEdited ? selectedDate : koreaDate(now);
