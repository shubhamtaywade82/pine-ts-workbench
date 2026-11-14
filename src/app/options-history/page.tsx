import { OptionsHistory } from "@/components/options-history/options-history";

export const metadata = { title: "Expired options history" };

/** /options-history?name=NIFTY&range=1M…: every setting lives in the URL, so a link reopens the same view. */
export default async function OptionsHistoryPage({ searchParams }: { readonly searchParams: Promise<Record<string, string | undefined>> }) {
  return <OptionsHistory query={await searchParams} />;
}
