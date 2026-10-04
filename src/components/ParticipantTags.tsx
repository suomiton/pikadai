interface Props {
  /** This browser's own row or comment. */
  isMine: boolean;
  isOrganiser: boolean;
  /** The organiser has disabled the participant; their answers no longer count. */
  isDisabled: boolean;
}

/** The pills after a participant's name, in the table and on comments. */
export function ParticipantTags({ isMine, isOrganiser, isDisabled }: Props) {
  return (
    <>
      {isMine && <span className="tag">you</span>}
      {isOrganiser && <span className="tag tag-accent">organiser</span>}
      {isDisabled && <span className="tag tag-danger">disabled</span>}
    </>
  );
}
