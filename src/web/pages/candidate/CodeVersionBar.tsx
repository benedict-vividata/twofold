import type { Position } from "../../../shared/model";
import { Segmented } from "../../components/ui";

export type CodeVersion = "none" | Position;

/** Chooses what the code tab shows while two versions await a decision. */
export function CodeVersionBar({
  value,
  onChange,
}: {
  value: CodeVersion;
  onChange: (value: CodeVersion) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface px-4 py-2">
      <span className="text-[12.5px] font-medium text-muted">Show</span>
      <Segmented<CodeVersion>
        size="sm"
        value={value}
        onChange={onChange}
        options={[
          { value: "none", label: "None" },
          {
            value: "a",
            label: (
              <>
                <span className="size-2 rounded-full bg-a" /> A
              </>
            ),
          },
          {
            value: "b",
            label: (
              <>
                <span className="size-2 rounded-full bg-b" /> B
              </>
            ),
          },
        ]}
      />
      <span className="hidden min-w-0 text-[12px] text-faint md:inline">
        {value === "none" ? (
          "The merged code, without either pending version."
        ) : (
          <>
            Version {value.toUpperCase()} applied to the code.{" "}
            <span className="text-ok">Green</span> marks added or changed lines,{" "}
            <span className="text-bad">red</span> marks where lines were removed.
          </>
        )}
      </span>
    </div>
  );
}
