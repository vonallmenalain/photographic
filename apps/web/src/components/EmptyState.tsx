import { ReactNode } from "react";
import { Card } from "./Card";

export function EmptyState({
  title,
  children
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <Card>
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
    </Card>
  );
}
