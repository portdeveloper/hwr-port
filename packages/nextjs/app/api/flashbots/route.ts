import { NextResponse } from "next/server";
import MevShareClient, { BundleParams, SupportedNetworks } from "@flashbots/mev-share-client";
import { JsonRpcProvider, Wallet } from "ethers";

const provider = new JsonRpcProvider(process.env.NEXT_PUBLIC_ALCHEMY_PROVIDER_URL, SupportedNetworks.sepolia);

const randomWallet = Wallet.createRandom();
const mevShareSigner = new Wallet(randomWallet.privateKey);

const authSigner = mevShareSigner.connect(provider);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(request: Request) {
  try {
    const { txs, targetBlock, maxBlockNumber } = await request.json();

    console.log("txs", txs);
    console.log("targetBlock", targetBlock);
    console.log("maxBlockNumber", maxBlockNumber);

    const bundle: BundleParams = {
      inclusion: {
        block: targetBlock,
        maxBlock: maxBlockNumber,
      },
      body: txs.map((tx: string, index: number) => ({
        tx,
        canRevert: index === 0, // Only allow the funding tx to revert
      })),
      privacy: {
        hints: {
          txHash: true,
          calldata: true,
          logs: true,
          functionSelector: true,
          contractAddress: true,
        },
        builders: ["flashbots"],
      },
    };

    const mevShareClientSepolia = new MevShareClient(authSigner, SupportedNetworks.sepolia);
    const simulationResult = await mevShareClientSepolia.simulateBundle(bundle);

    console.log("simulationResult", simulationResult);

    if (!simulationResult.success) {
      return NextResponse.json(
        { error: simulationResult },
        {
          status: 400,
          headers: corsHeaders,
        },
      );
    }

    const bundleResult = await mevShareClientSepolia.sendBundle(bundle);
    console.log("Bundle sent:", bundleResult);

    return NextResponse.json(
      { success: true },
      {
        status: 200,
        headers: corsHeaders,
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }
}
