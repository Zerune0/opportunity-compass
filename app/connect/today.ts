/**
 * 本地日历日期 `YYYY-MM-DD`。会读系统时钟，所以只在事件处理里或挂载之后调用，不在渲染时调用
 * （服务器渲染与首次客户端渲染要一致）。lib/connect 的纯函数都由这里传入日期。
 */
export function localToday(): string {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}
