import { useState } from "react";
import { isAddress } from "viem";

export const useAssetDetection = () => {
  const [detectedAssets, setDetectedAssets] = useState<any[]>([]); // type this!
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectAssets = async (hackedAddress: string) => {
    if (!isAddress(hackedAddress)) {
      setError("Invalid hacked address");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `https://deep-index.moralis.io/api/v2.2/${hackedAddress}/nft?chain=eth&format=decimal&exclude_spam=false&media_items=false`,
        {
          headers: {
            accept: "application/json",
            "X-API-Key": process.env.NEXT_PUBLIC_MORALIS_API_KEY || "",
          },
        },
      );

      if (!response.ok) {
        throw new Error("Failed to fetch NFTs");
      }

      const data = await response.json();

      const nftAssets = data.result.map((nft: any) => ({
        type: nft.contract_type.toLowerCase(),
        info: `${nft.name || "Unknown NFT"} #${nft.token_id}`,
        contractAddress: nft.token_address,
        tokenId: nft.token_id,
        tokenIds: [nft.token_id],
        amounts: ["1"],
        symbol: nft.symbol || "",
      }));

      setDetectedAssets(nftAssets);
    } catch (error) {
      setError("Failed to detect assets");
      console.error("Error fetching NFTs:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    detectedAssets,
    isLoading,
    error,
    detectAssets,
  };
};
