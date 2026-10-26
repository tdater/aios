import { ConversationScreen } from "./work/Conversation";
import { WorkPicker } from "./work/Picker";

/** Main workspace: pick a project, talk to Claude about it, watch what it does, review the change,
 *  see the test result, and decide. Route: #/work (picker) and #/work/<conversation id>. */
export function Workspace({ id }: { id?: string }) {
  return id ? <ConversationScreen id={id} /> : <WorkPicker />;
}
