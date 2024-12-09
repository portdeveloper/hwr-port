"use client";

import { useState } from "react";
import { SupportedNetworks } from "@flashbots/mev-share-client";
import { Interface, JsonRpcProvider, TransactionRequest, keccak256, toBigInt } from "ethers";
import type { NextPage } from "next";
import { v4 as uuidv4 } from "uuid";
import { sepolia } from "viem/chains";
import { useAccount, useWalletClient } from "wagmi";
import { Address } from "~~/components/scaffold-eth";
import { useAssetDetection } from "~~/hooks/hwr/useAssetDetection";
import { notification } from "~~/utils/scaffold-eth";

const provider = new JsonRpcProvider(process.env.NEXT_PUBLIC_ALCHEMY_PROVIDER_URL, SupportedNetworks.sepolia);
const NUM_TARGET_BLOCKS = 20;
const erc721Interface = new Interface(["function transferFrom(address from, address to, uint256 tokenId)"]);

const Home: NextPage = () => {
  const [hackedAddress, setHackedAddress] = useState<string>("0x82276723dbDca510879e2fe8BECD0B10df96d6DC");
  const [secureAddress, setSecureAddress] = useState<string>("0x9A3C34EB976C13D721BDbcea5cb922b0cb2A6E1E");
  const [txBasket, setTxBasket] = useState<Array<TransactionRequest>>([]);

  const { detectedAssets, isLoading: isDetectingAssets, error, detectAssets } = useAssetDetection();

  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();

  //console.log("address", address);

  const [isRecovering, setIsRecovering] = useState(false);
  const [bundleId] = useState<string>(uuidv4());
  const [isFundingComplete, setIsFundingComplete] = useState(false);

  const addFlashbotsRpc = async () => {
    // Add Flashbots RPC
    const params = {
      chainId: "0xaa36a7", // Sepolia chainId in hex
      chainName: "Flashbots Bundle RPC",
      nativeCurrency: {
        name: "ETH",
        symbol: "ETH",
        decimals: 18,
      },
      rpcUrls: [`https://rpc-sepolia.flashbots.net`],
      blockExplorerUrls: ["https://sepolia.etherscan.io"],
    };

    try {
      await window.ethereum?.request({
        method: "wallet_addEthereumChain",
        params: [params],
      });
    } catch (error) {
      console.error("Failed to add Flashbots RPC:", error);
      throw new Error("Failed to add Flashbots RPC. Please add it manually.");
    }
  };

  const fundingTx = async () => {
    const feeData = await provider.getFeeData();
    const baseFee = toBigInt(feeData.maxFeePerGas || 42);
    const priorityFee = toBigInt(feeData.maxPriorityFeePerGas || 2);

    const maxPriorityFeePerGas = priorityFee + BigInt(1e9); // Add 1 gwei priority fee
    const maxFeePerGas = baseFee + maxPriorityFeePerGas; // Base fee + priority fee

    await walletClient?.sendTransaction({
      account: walletClient.account,
      chain: sepolia,
      type: "eip1559",
      to: hackedAddress,
      nonce: await provider.getTransactionCount(walletClient.account.address),
      value: BigInt(100000) * maxFeePerGas + BigInt(1e16),
      gasLimit: 22000,
      data: "0x",
      maxFeePerGas,
      maxPriorityFeePerGas,
    });

    setIsFundingComplete(true);
    notification.success(
      "Funding transaction sent! Please switch to the hacked wallet and click 'Continue with NFT Transfer' when ready.",
    );
  };

  const nftTransferTx = async () => {
    const feeData = await provider.getFeeData();
    const baseFee = toBigInt(feeData.maxFeePerGas || 42);
    const priorityFee = toBigInt(feeData.maxPriorityFeePerGas || 2);

    const maxPriorityFeePerGas = priorityFee + BigInt(1e9);
    const maxFeePerGas = baseFee + maxPriorityFeePerGas;

    // Now proceed with the NFT transfer transaction
    await walletClient?.sendTransaction({
      account: walletClient.account,
      chain: sepolia,
      type: "eip1559",
      to: secureAddress,
      nonce: await provider.getTransactionCount(walletClient.account.address),
      value: BigInt(1e16),
      data: erc721Interface.encodeFunctionData("transferFrom", [
        hackedAddress,
        secureAddress,
        BigInt(186),
      ]) as `0x${string}`,
      gasLimit: 22000,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });
  };

  const submitBundle = async () => {
    // Retrieve bundle from cache and send to relay
    const finalBundle = await fetch(`https://rpc-sepolia.flashbots.net/bundle?id=${bundleId}`).then(r => r.json());

    console.log("finalBundle", finalBundle);

    if (!finalBundle || !finalBundle.rawTxs) {
      throw new Error("Failed to retrieve bundle from cache");
    }

    const txs = finalBundle.rawTxs.reverse();

    console.log("ready to send bundle txs", txs);

    // Send bundle to your backend
    const response = await fetch("/api/flashbots", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        txs,
        targetBlock: (await provider.getBlockNumber()) + 1,
        maxBlockNumber: (await provider.getBlockNumber()) + NUM_TARGET_BLOCKS,
      }),
    });

    const result = await response.json();
    console.log("Bundle submission result:", result);

    if (!result.success) {
      throw new Error(result.error || "Failed to submit bundle");
    }

    // Monitor for inclusion
    const txHash = keccak256(txs[0]);
    console.log(`Monitoring transaction ${txHash} for inclusion...`);

    for (let i = 0; i < NUM_TARGET_BLOCKS; i++) {
      const currentBlock = await provider.getBlockNumber();
      const receipt = await provider.getTransactionReceipt(txHash);

      if (receipt) {
        console.log(`Bundle included in block ${receipt.blockNumber}!`);
        console.log(`Transaction status: ${receipt.status === 1 ? "SUCCESS" : "FAILED"}`);
        setIsRecovering(false);
        return { receipt };
      }

      console.log(`Not included in block ${currentBlock}, continuing to monitor...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  };

  const startRecovery = async () => {
    try {
      if (!walletClient?.account) {
        throw new Error("Wallet not connected");
      }

      // Check wallet connection
      if (address === hackedAddress.toLowerCase()) {
        throw new Error(
          "Please switch to a different wallet to send the funding transaction. Do not use the hacked wallet.",
        );
      }
      setIsRecovering(true);

      //// ORIGINAL TX THAT WORKED! VIEM ONE MAY NOT WORK! BUT REQUIRED TO USE WALLETCLIENT SINCE SE-2 USES IT
      ////
      // const tx1: TransactionRequest = {
      //   type: 2,
      //   chainId: provider._network.chainId,
      //   to: hackedAddress,
      //   nonce: nonce,
      //   // Calculate required ETH: gas limit × (base fee + priority fee) × safety multiplier
      //   value: BigInt(100000) * maxFeePerGas + BigInt(1e16), // Add 0.01 ETH buffer
      //   gasLimit: 22000,
      //   data: "0x",
      //   maxFeePerGas,
      //   maxPriorityFeePerGas,
      // };

      await addFlashbotsRpc();
      await fundingTx();
      // Remove submitBundle from here - it will be called after NFT transfer
    } catch (error) {
      console.error("Recovery failed:", error);
      notification.error((error as Error).message);
      setIsRecovering(false);
    }
  };

  const continueWithNftTransfer = async () => {
    try {
      if (address?.toLowerCase() !== hackedAddress.toLowerCase()) {
        throw new Error("Please switch to the hacked wallet before continuing");
      }
      await nftTransferTx();
      await submitBundle(); // Move submitBundle here after NFT transfer
      setIsFundingComplete(false); // Reset the state
      setIsRecovering(false); // Reset recovering state after bundle submission
    } catch (error) {
      console.error("NFT transfer failed:", error);
      notification.error((error as Error).message);
      setIsRecovering(false);
    }
  };

  return (
    <>
      <div className="flex-grow bg-base-300 w-full px-8 py-12">
        <div className="flex gap-8">
          {/* Left Column - Asset Detection */}
          <div className="flex-1">
            <div className="flex flex-col items-center gap-4">
              <input
                type="text"
                placeholder="Enter hacked wallet address"
                className="input input-bordered w-full max-w-md"
                value={hackedAddress}
                onChange={e => setHackedAddress(e.target.value)}
              />
              <input
                type="text"
                placeholder="Enter secure wallet address"
                className="input input-bordered w-full max-w-md"
                value={secureAddress}
                onChange={e => setSecureAddress(e.target.value)}
              />

              <button
                className="btn btn-neutral"
                onClick={() => detectAssets(hackedAddress)}
                disabled={isDetectingAssets || !hackedAddress}
              >
                {isDetectingAssets ? "Detecting Assets..." : "Detect Assets"}
              </button>

              {error && <div className="text-error">Error: {error}</div>}

              {detectedAssets && detectedAssets.length > 0 && (
                <div className="w-full">
                  <h2 className="text-2xl font-bold mb-4">Detected Assets</h2>
                  <div className="overflow-x-auto">
                    <table className="table w-full">
                      <thead>
                        <tr>
                          <th>Select</th>
                          <th>Name</th>
                          <th>Token ID/Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detectedAssets.map((asset, index) => (
                          <tr key={index}>
                            <td>
                              <input
                                type="checkbox"
                                checked={txBasket.some(
                                  tx => tx.to === asset.contractAddress && tx.data?.includes(asset.tokenId.toString()),
                                )}
                                onChange={() => {
                                  // Create ERC721 transfer transaction
                                  const transferData = erc721Interface.encodeFunctionData("transferFrom", [
                                    hackedAddress,
                                    secureAddress,
                                    asset.tokenId,
                                  ]);

                                  const newTx: TransactionRequest = {
                                    to: asset.contractAddress,
                                    from: hackedAddress,
                                    data: transferData,
                                    type: 2, // EIP-1559 transaction
                                    chainId: 11155111, // Sepolia
                                  };

                                  // Toggle transaction in basket
                                  if (
                                    txBasket.some(
                                      tx =>
                                        tx.to === asset.contractAddress && tx.data?.includes(asset.tokenId.toString()),
                                    )
                                  ) {
                                    setTxBasket(
                                      txBasket.filter(
                                        tx =>
                                          !(
                                            tx.to === asset.contractAddress &&
                                            tx.data?.includes(asset.tokenId.toString())
                                          ),
                                      ),
                                    );
                                  } else {
                                    setTxBasket([...txBasket, newTx]);
                                  }
                                }}
                              />
                            </td>
                            <td>{asset.info}</td>
                            <td className="font-mono text-sm">{asset.tokenId}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Basket */}
          <div className="flex-1 border-l border-base-200 pl-8">
            <h2 className="text-2xl font-bold mb-4">Tx Basket</h2>
            {txBasket.length > 0 ? (
              <>
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th>Contract</th>
                      <th>Token ID</th>
                      <th>From</th>
                      <th>To</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txBasket.map((tx, index) => (
                      <tr key={index}>
                        <td className="font-mono text-sm">
                          <Address address={tx.to?.toString()} size="xs" />
                          <div className="text-xs opacity-70">
                            {detectedAssets.find(asset => asset.contractAddress === tx.to)?.info}
                          </div>
                        </td>
                        <td className="font-mono text-sm">
                          {tx.data && erc721Interface.parseTransaction({ data: tx.data })?.args[2].toString()}
                        </td>
                        <td className="font-mono text-sm">
                          <Address address={tx.from?.toString()} size="xs" />
                        </td>
                        <td className="font-mono text-sm">
                          <Address
                            address={tx.data && erc721Interface.parseTransaction({ data: tx.data })?.args[1].toString()}
                            size="xs"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="flex flex-col gap-4 mt-4">
                  <button
                    className="btn btn-neutral"
                    onClick={startRecovery}
                    disabled={isRecovering || txBasket.length === 0}
                  >
                    {isRecovering ? "Recovering..." : "Start Recovery"}
                  </button>

                  {isFundingComplete && (
                    <button className="btn btn-primary" onClick={continueWithNftTransfer}>
                      Continue with NFT Transfer
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p>No assets selected</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default Home;
