import { useValues } from 'kea'

import { heatmapLogic } from '~/toolbar/elements/heatmapLogic'

import { toolbarConfigLogic } from '../toolbarConfigLogic'
import { useMousePosition } from './useMousePosition'

function ScrollDepthMouseInfo(): JSX.Element | null {
    const { posthog } = useValues(toolbarConfigLogic)
    const { heatmapElements, rawHeatmapLoading } = useValues(heatmapLogic)

    const { y: mouseY } = useMousePosition()

    if (!mouseY) {
        return null
    }

    const scrollOffset = (posthog as any).scrollManager.scrollY()
    const scrolledMouseY = mouseY + scrollOffset

    const elementInMouseY = heatmapElements.find((x, i) => {
        const lastY = heatmapElements[i - 1]?.y ?? 0
        return scrolledMouseY >= lastY && scrolledMouseY < x.y
    })

    const maxCount = heatmapElements[0]?.count ?? 0
    const percentage = ((elementInMouseY?.count ?? 0) / maxCount) * 100

    return (
        <div
            className="absolute left-0 right-0 flex items-center z-10"
            // eslint-disable-next-line react/forbid-dom-props
            style={{
                top: mouseY,
                transform: 'translateY(-50%)',
            }}
        >
            <div className="border-b w-full" />
            <div className="bg-border whitespace-nowrap text-default rounded p-2 font-semibold">
                {rawHeatmapLoading ? (
                    <>Loading...</>
                ) : heatmapElements.length ? (
                    <>{percentage.toPrecision(4)}% scrolled this far</>
                ) : (
                    <>No scroll data for the current dimension range</>
                )}
            </div>

            <div className="border-b w-10" />
        </div>
    )
}

export function ScrollDepth(): JSX.Element | null {
    const { posthog } = useValues(toolbarConfigLogic)

    const { heatmapEnabled, heatmapFilters, heatmapElements, scrollDepthPosthogJsError } = useValues(heatmapLogic)

    if (!heatmapEnabled || !heatmapFilters.enabled || heatmapFilters.type !== 'scrolldepth') {
        return null
    }

    if (scrollDepthPosthogJsError) {
        return null
    }

    const scrollOffset = (posthog as any).scrollManager.scrollY()

    // We want to have a fading color from red to orange to green to blue to grey, fading from the highest count to the lowest
    const maxCount = heatmapElements[0]?.count ?? 0

    function color(count: number): string {
        const value = 1 - count / maxCount
        const safeValue = Math.max(0, Math.min(1, value))
        const hue = Math.round(260 * safeValue)

        // Return hsl color. You can adjust saturation and lightness to your liking
        return `hsl(${hue}, 100%, 50%)`
    }

    return (
        <div className="fixed inset-0 overflow-hidden">
            <div
                className="absolute top-0 left-0 right-0"
                // eslint-disable-next-line react/forbid-dom-props
                style={{
                    transform: `translateY(${-scrollOffset}px)`,
                }}
            >
                {heatmapElements.map(({ y, count }, i) => (
                    <div
                        key={y}
                        // eslint-disable-next-line react/forbid-dom-props
                        style={{
                            position: 'absolute',
                            top: heatmapElements[i - 1]?.y ?? 0,
                            left: 0,
                            width: '100%',
                            height: y - (heatmapElements[i - 1]?.y ?? 0),
                            backgroundColor: color(count),
                            opacity: 0.5,
                        }}
                    />
                ))}
            </div>
            <ScrollDepthMouseInfo />
        </div>
    )
}
