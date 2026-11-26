# Written for these tests: ToothGrowth summarised by a helper function, drawn as
# side-by-side bars of the mean with +/- SD error bars; the plot is built in two statements.
library(ggplot2)

mean_and_sd <- function(d, value, by) {
  f <- reformulate(by, response = value)
  out <- aggregate(f, data = d, FUN = mean)
  out$sd <- aggregate(f, data = d, FUN = sd)[[value]]
  out
}
tg <- mean_and_sd(ToothGrowth, "len", c("supp", "dose"))
tg$dose <- factor(tg$dose)

g <- ggplot(tg, aes(x = dose, y = len, fill = supp)) +
  geom_bar(stat = "identity", position = position_dodge(), colour = "black") +
  geom_errorbar(aes(ymin = len - sd, ymax = len + sd), position = position_dodge(0.9), width = 0.25)
g + scale_fill_manual(values = c("#56B4E9", "#009E73")) +
  labs(title = "Odontoblast length by vitamin C dose", x = "Vitamin C (mg/day)", y = "Length") +
  theme_classic()
