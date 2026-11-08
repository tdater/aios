import { go } from "../ui/hooks";
import { Btn } from "../ui/kit";
import { useApp } from "../ui/Context";

/** Shown on the phone's own AIOS for the parts that only exist on a PC (Claude, projects, approvals, history). */
export function NeedsPc({ what }: { what: string }) {
  const { switchServer } = useApp();
  return (
    <div className="screen">
      <h2>{what} needs your PC</h2>
      <p>This is the phone&apos;s own AIOS, and it keeps working without anything else. {what} lives on AIOS running on your PC, because it uses Claude and your projects there.</p>
      <div className="row">
        <Btn onClick={() => switchServer(null)}>Connect to my PC</Btn>
        <Btn kind="ghost" onClick={() => go({ tab: "home" })}>Back to my universe</Btn>
      </div>
    </div>
  );
}
