import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

const ydoc = new Y.Doc();
const provider = new WebsocketProvider("ws://localhost:1234", "persist-test", ydoc);
provider.on("sync", async (synced) => {
  if (!synced) return;
  const frag = ydoc.getXmlFragment("document");
  console.log("fragment length after sync:", frag.length);
  const p = new Y.XmlElement("paragraph");
  const text = new Y.XmlText();
  text.insert(0, "persist test " + Date.now());
  p.insert(0, [text]);
  frag.insert(frag.length, [p]);
  console.log("inserted, waiting for server persist...");
  setTimeout(() => { process.exit(0); }, 4000);
});
