// ページ離脱時の警告が必要かどうかを判定
export const shouldBlockPageLeave = (cuesLength) => {
  return cuesLength > 0;
};
