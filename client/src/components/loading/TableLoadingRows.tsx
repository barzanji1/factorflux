import "./loading.css";

/** Keeps headers/controls mounted and reserves real row space during a fetch. */
export function TableLoadingRows({ columns, rows = 5 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} data-table-loading aria-busy="true">
          {Array.from({ length: columns }, (_, column) => (
            <td key={column} className="px-4 py-3">
              {row === 0 && column === 0 && <span className="sr-only" role="status">Loading records</span>}
              <span aria-hidden="true" className="ff-loading-placeholder ff-loading-placeholder--full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
