import { SHORTCUT_GROUPS } from "./shortcuts";
import { cx } from "../ui";

export function ShortcutTable({ caption, className }: { caption: string; className?: string }) {
  return (
    <table className={cx("mk-table text-[14.5px]", className)}>
      <caption className="pb-3 text-left text-[13px] text-muted">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Action</th>
          <th scope="col" style={{ textAlign: "end" }}>
            Shortcut
          </th>
        </tr>
      </thead>
      {SHORTCUT_GROUPS.map((group) => (
        <tbody key={group.group}>
          <tr>
            <th scope="rowgroup" colSpan={2} className="pt-5 text-[11.5px] font-semibold uppercase tracking-[0.12em] text-faint">
              {group.group}
            </th>
          </tr>
          {group.rows.map((row) => (
            <tr key={row.action}>
              <th scope="row" className="font-normal text-ink">
                {row.action}
              </th>
              <td>
                <span className="inline-flex flex-wrap justify-end gap-1.5">
                  {row.keys.map((key) => (
                    <kbd key={key} className="mk-kbd tracking-[0.08em]">
                      {key}
                    </kbd>
                  ))}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}
