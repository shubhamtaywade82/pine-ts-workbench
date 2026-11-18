import type { Metadata } from "next";
import { SmcTerminal } from "@/components/smc-terminal/smc-terminal";

export const metadata: Metadata = {
  title: "NEMESIS · SMC Confluence Terminal v9",
  description: "NEMESIS Smart Money Concepts Liquidity Rails & Ladder Terminal v9",
};

export default function SmcTerminalPage() {
  return <SmcTerminal />;
}
