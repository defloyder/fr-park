import { ROAD_MARKING_ARROW_IMAGES, ROAD_MARKING_TRAFFIC_SIGNAL_IMAGE } from './roadMarkingConfig';

const ARROW_COLOR = 'rgba(248, 250, 252, 0.94)';
const ARROW_SHADOW = 'rgba(12, 24, 39, 0.34)';

export function addRoadMarkingImages(map) {
    addArrowImage(map, ROAD_MARKING_ARROW_IMAGES.through, drawThroughArrow);
    addArrowImage(map, ROAD_MARKING_ARROW_IMAGES.left, (context, metrics) => drawTurnArrow(context, metrics, 'left'));
    addArrowImage(map, ROAD_MARKING_ARROW_IMAGES.right, (context, metrics) => drawTurnArrow(context, metrics, 'right'));
    addArrowImage(map, ROAD_MARKING_ARROW_IMAGES.through_left, (context, metrics) => drawForkArrow(context, metrics, 'left'));
    addArrowImage(map, ROAD_MARKING_ARROW_IMAGES.through_right, (context, metrics) => drawForkArrow(context, metrics, 'right'));
    addArrowImage(map, ROAD_MARKING_ARROW_IMAGES.left_right, drawLeftRightArrow);
    addArrowImage(map, ROAD_MARKING_ARROW_IMAGES.u_turn, drawUTurnArrow);
    addArrowImage(map, ROAD_MARKING_ARROW_IMAGES.slight_left, (context, metrics) => drawSlightArrow(context, metrics, 'left'));
    addArrowImage(map, ROAD_MARKING_ARROW_IMAGES.slight_right, (context, metrics) => drawSlightArrow(context, metrics, 'right'));
    addTrafficSignalImage(map);
}

function addTrafficSignalImage(map) {
    if (map.hasImage(ROAD_MARKING_TRAFFIC_SIGNAL_IMAGE)) {
        return;
    }

    const width = 46;
    const height = 70;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    if (!context) {
        return;
    }

    context.clearRect(0, 0, width, height);
    context.fillStyle = 'rgba(10, 19, 31, 0.76)';
    roundRect(context, 9, 3, 28, 54, 8);
    context.fill();

    drawSignalLamp(context, 23, 15, '#EF4444');
    drawSignalLamp(context, 23, 30, '#FBBF24');
    drawSignalLamp(context, 23, 45, '#22C55E');

    context.strokeStyle = 'rgba(237, 244, 251, 0.68)';
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(23, 57);
    context.lineTo(23, 68);
    context.stroke();

    map.addImage(ROAD_MARKING_TRAFFIC_SIGNAL_IMAGE, context.getImageData(0, 0, width, height), { pixelRatio: 2 });
}

function drawSignalLamp(context, x, y, color) {
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, 5, 0, Math.PI * 2);
    context.fill();
}

function roundRect(context, x, y, width, height, radius) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + width - radius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + radius);
    context.lineTo(x + width, y + height - radius);
    context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    context.lineTo(x + radius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
    context.closePath();
}

function addArrowImage(map, id, draw) {
    if (map.hasImage(id)) {
        return;
    }

    const width = 76;
    const height = 126;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');

    if (!context) {
        return;
    }

    context.clearRect(0, 0, width, height);
    draw(context, { width, height, centerX: width / 2, baseY: 102, headY: 24 });

    map.addImage(id, context.getImageData(0, 0, width, height), { pixelRatio: 2 });
}

function setupPaint(context, shadow = false) {
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = shadow ? ARROW_SHADOW : ARROW_COLOR;
    context.fillStyle = shadow ? ARROW_SHADOW : ARROW_COLOR;
}

function drawArrowHead(context, x, y, angle, size) {
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.beginPath();
    context.moveTo(0, -size);
    context.lineTo(size * 0.64, size * 0.62);
    context.lineTo(0, size * 0.2);
    context.lineTo(-size * 0.64, size * 0.62);
    context.closePath();
    context.fill();
    context.restore();
}

function drawPathWithShadow(context, drawPath, width = 7) {
    setupPaint(context, true);
    context.lineWidth = width + 3;
    drawPath();
    context.stroke();

    setupPaint(context);
    context.lineWidth = width;
    drawPath();
    context.stroke();
}

function drawThroughArrow(context, { centerX, baseY = 88, headY = 21 }) {
    drawPathWithShadow(context, () => {
        context.beginPath();
        context.moveTo(centerX, baseY);
        context.lineTo(centerX, headY + 6);
    });
    setupPaint(context, true);
    drawArrowHead(context, centerX, headY, 0, 17);
    setupPaint(context);
    drawArrowHead(context, centerX, headY, 0, 17);
}

function drawTurnArrow(context, { centerX, baseY = 88, headY = 25 }, side) {
    const sign = side === 'left' ? -1 : 1;
    drawPathWithShadow(context, () => {
        context.beginPath();
        context.moveTo(centerX, baseY);
        context.lineTo(centerX, 66);
        context.quadraticCurveTo(centerX, 40, centerX + sign * 19, 38);
    });
    setupPaint(context, true);
    drawArrowHead(context, centerX + sign * 24, 38, sign * Math.PI / 2, 14);
    setupPaint(context);
    drawArrowHead(context, centerX + sign * 24, 38, sign * Math.PI / 2, 14);
}

function drawForkArrow(context, metrics, side) {
    const { centerX } = metrics;
    const sign = side === 'left' ? -1 : 1;
    drawThroughArrow(context, metrics);
    drawPathWithShadow(context, () => {
        context.beginPath();
        context.moveTo(centerX, 76);
        context.quadraticCurveTo(centerX + sign * 3, 49, centerX + sign * 22, 39);
    }, 6);
    setupPaint(context);
    drawArrowHead(context, centerX + sign * 27, 37, sign * Math.PI / 2.6, 14);
}

function drawLeftRightArrow(context, { centerX, baseY = 88 }) {
    drawPathWithShadow(context, () => {
        context.beginPath();
        context.moveTo(centerX, baseY);
        context.lineTo(centerX, 72);
        context.moveTo(centerX, 72);
        context.quadraticCurveTo(centerX - 4, 44, centerX - 24, 39);
        context.moveTo(centerX, 72);
        context.quadraticCurveTo(centerX + 4, 44, centerX + 24, 39);
    }, 6);
    setupPaint(context, true);
    drawArrowHead(context, centerX - 29, 39, -Math.PI / 2, 14);
    drawArrowHead(context, centerX + 29, 39, Math.PI / 2, 14);
    setupPaint(context);
    drawArrowHead(context, centerX - 29, 39, -Math.PI / 2, 14);
    drawArrowHead(context, centerX + 29, 39, Math.PI / 2, 14);
}

function drawUTurnArrow(context, { centerX, baseY = 88 }) {
    drawPathWithShadow(context, () => {
        context.beginPath();
        context.moveTo(centerX + 11, baseY);
        context.lineTo(centerX + 11, 54);
        context.quadraticCurveTo(centerX + 11, 30, centerX - 8, 30);
        context.quadraticCurveTo(centerX - 26, 30, centerX - 26, 54);
        context.lineTo(centerX - 26, 69);
    }, 6);
    setupPaint(context);
    drawArrowHead(context, centerX - 26, 74, Math.PI, 14);
}

function drawSlightArrow(context, { centerX, baseY = 88 }, side) {
    const sign = side === 'left' ? -1 : 1;
    drawPathWithShadow(context, () => {
        context.beginPath();
        context.moveTo(centerX, baseY);
        context.lineTo(centerX, 74);
        context.quadraticCurveTo(centerX, 50, centerX + sign * 16, 33);
    }, 6);
    setupPaint(context);
    drawArrowHead(context, centerX + sign * 20, 29, sign * Math.PI / 5, 14);
}
