import { Page } from "../../src/components/Shell";
import { LiveAuctions } from "../../src/components/LiveAuctions";

export default function AuctionsPage() {
  return (
    <Page
      title="Auctions"
      lead="Every auction on chain, found by scanning the event each one emits when it is created. No server keeps a list, so nothing here can be filtered or taken down."
    >
      <LiveAuctions />
    </Page>
  );
}
