import { Chat } from "@/components/chat";
import { listSourceOptions } from "@/analysis/source-options";

export default function Home() {
  return <Chat sources={listSourceOptions()} />;
}
