import { StoryCard, StoryRow } from "../../.ladle/story-card";
import { CompactHomePage, PhoneFrame } from "./mobile-home-story-fixtures";

export default {
  title: "views/Compact Home",
};

export function Overview() {
  return (
    <StoryCard labelWidth="170px">
      <StoryRow
        label="composer pinned"
        hint="393×852. The composer is an overlay at the bottom of an otherwise empty home; recents moved to the inbox."
      >
        <PhoneFrame>
          <CompactHomePage />
        </PhoneFrame>
      </StoryRow>
    </StoryCard>
  );
}
