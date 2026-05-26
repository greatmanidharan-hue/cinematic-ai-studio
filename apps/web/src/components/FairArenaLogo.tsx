import React from "react";

type FairArenaLogoProps = {
  className?: string;
  title?: string;
};

export const FairArenaLogo: React.FC<FairArenaLogoProps> = ({
  className = "",
  title = "FairArena Logo",
}) => (
  <img
    src="/fairArenaLogo.png"
    alt={title}
    className={className}
  />
);

export default FairArenaLogo;