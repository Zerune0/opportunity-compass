import { QuestDetails } from "./quest-details";
export default async function Page({ params }: {
    params: Promise<{
        id: string;
    }>;
}) {
    const { id } = await params;
    return <QuestDetails id={id}/>;
}
